-- supabase/migrations/0007_waiting_room.sql
--
-- Purpose:
--   Opt-in waiting room per room. Default OFF so existing rooms and the
--   one-click-invite flow keep working unchanged. When a host turns it
--   ON for a room:
--     - Guests redeeming an invite are *not* added to room_members.
--       Instead, a row goes into `public.room_join_requests` with
--       status 'pending'.
--     - The host sees pending rows live via Realtime (postgres_changes
--       filtered by room_id) and approves or rejects each one.
--     - On approve: token is consumed and membership inserted, in one
--       transaction. Same end-state as the no-waiting-room path.
--     - On reject: status flips to 'rejected'. The token is NOT burned
--       so the host can change their mind later (soft reject).
--
-- Note on re-application:
--   This migration changes `redeem_invite`'s return type from `void` (set
--   in 0004) to `uuid`. Postgres refuses `create or replace` when the
--   return type changes (error 42P13). The drop below makes the migration
--   idempotent: it removes the old signature first, then re-creates it
--   with the new one.
--
-- Compatibility:
--   `public.redeem_invite(room_id, token)` is kept as the single client
--   entry point. Internally it now branches:
--     - waiting_room_enabled = false -> same behavior as 0004 (consume
--       token, insert membership).
--     - waiting_room_enabled = true  -> create a pending request and
--       return its id (the guest's client polls/streams on this id).
--   This means a stale Phase 1 client calling redeem_invite still works:
--   if the host opts in to waiting room, the call succeeds but membership
--   is deferred until approval; old clients without UI for that will see
--   a "subscribe failed" later, which is acceptable as a v1 degrade.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   (Or: supabase db push from a linked project.)

-------------------------------------------------------------------------------
-- 1. rooms.waiting_room_enabled flag
-------------------------------------------------------------------------------

alter table public.rooms
  add column if not exists waiting_room_enabled boolean not null default false;

-------------------------------------------------------------------------------
-- 2. room_join_requests
-------------------------------------------------------------------------------
--
-- One row per (room, guest) per request. A guest may have multiple rows
-- over time (rejected, then re-requests). The host's UI shows the most
-- recent pending row per requester.

create table if not exists public.room_join_requests (
  id           uuid        primary key default gen_random_uuid(),
  room_id      text        not null references public.rooms(id) on delete cascade,
  user_id      uuid        not null references auth.users(id)  on delete cascade,
  -- The invite token they presented. We need it at approve time so we
  -- can run the same consume+insert atomically as redeem_invite did.
  token        text        not null,
  -- Display name the guest wants shown to the host. Best-effort; we
  -- fall back to their user_id slice when missing.
  display_name text,
  status       text        not null default 'pending'
                            check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid                 references auth.users(id) on delete set null
);

-- Hosts query by room (the "approval inbox"); guests query by their own
-- request id. Composite index covers both with the room_id leader.
create index if not exists room_join_requests_room_status_idx
  on public.room_join_requests (room_id, status);
create index if not exists room_join_requests_user_id_idx
  on public.room_join_requests (user_id);

alter table public.room_join_requests enable row level security;

-- Hosts can see every request for their room (any status, for history).
drop policy if exists "hosts can read room requests" on public.room_join_requests;
create policy "hosts can read room requests"
  on public.room_join_requests
  for select
  to authenticated
  using ( public.is_room_host(room_id) );

-- A user can read THEIR OWN requests (so the guest client can watch the
-- status flip from pending -> approved/rejected).
drop policy if exists "users can read their own requests" on public.room_join_requests;
create policy "users can read their own requests"
  on public.room_join_requests
  for select
  to authenticated
  using ( user_id = auth.uid() );

-- No direct INSERT / UPDATE / DELETE policies. All writes go through the
-- SECURITY DEFINER RPCs below.

-------------------------------------------------------------------------------
-- 3. set_waiting_room_enabled (host-only)
-------------------------------------------------------------------------------

create or replace function public.set_waiting_room_enabled(
  p_room_id text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'only the host can change waiting room' using errcode = '42501';
  end if;

  update public.rooms
     set waiting_room_enabled = p_enabled
   where id = p_room_id;
end;
$$;

revoke all on function public.set_waiting_room_enabled(text, boolean) from public;
grant execute on function public.set_waiting_room_enabled(text, boolean) to authenticated;

-------------------------------------------------------------------------------
-- 4. Reshape redeem_invite to branch on waiting_room_enabled
-------------------------------------------------------------------------------
--
-- Returns the new request id when the room has waiting room enabled, or
-- NULL when membership was granted directly (Phase 1 behavior). A non-null
-- return signals "wait for approval" to the client.

-- Drop the old signature first. Postgres refuses to change a function's
-- return type via `create or replace` (error 42P13). Revoking execute is
-- implicit: dropping the function removes its privilege grants.
drop function if exists public.redeem_invite(text, text);

create or replace function public.redeem_invite(p_room_id text, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_invite  public.room_invites%rowtype;
  v_waiting boolean;
  v_req_id  uuid;
  v_name    text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Lock the invite row so concurrent redemptions can't both win.
  select * into v_invite
  from public.room_invites
  where room_id = p_room_id and token = p_token
  for update;

  if not found then
    raise exception 'invalid invite' using errcode = 'P0002';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'invite expired' using errcode = '22023';
  end if;
  if v_invite.used_by is not null then
    raise exception 'invite already used' using errcode = '22023';
  end if;

  -- Read the room's waiting-room flag. SELECT runs as definer so we
  -- bypass the rooms.SELECT RLS (caller may not yet be a member).
  select waiting_room_enabled into v_waiting
  from public.rooms
  where id = p_room_id;

  if v_waiting then
    -- Pull a best-effort display name from auth.users metadata.
    select coalesce(
             raw_user_meta_data->>'name',
             raw_user_meta_data->>'full_name',
             email
           )
      into v_name
      from auth.users
     where id = v_uid;

    insert into public.room_join_requests (
      room_id, user_id, token, display_name, status
    ) values (
      p_room_id, v_uid, p_token, v_name, 'pending'
    )
    returning id into v_req_id;

    -- Token stays unconsumed until approval. Guest waits.
    return v_req_id;
  end if;

  -- Original Phase 1 path: consume + insert atomically.
  update public.room_invites
     set used_by = v_uid, used_at = now()
   where id = v_invite.id;

  insert into public.room_members (room_id, user_id, role)
  values (p_room_id, v_uid, 'guest')
  on conflict (room_id, user_id) do nothing;

  return null;
end;
$$;

revoke all on function public.redeem_invite(text, text) from public;
grant execute on function public.redeem_invite(text, text) to authenticated;

-------------------------------------------------------------------------------
-- 5. approve_join (host-only)
-------------------------------------------------------------------------------

create or replace function public.approve_join(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.room_join_requests%rowtype;
  v_invite public.room_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Lock the request row to prevent two hosts double-approving.
  select * into v_req
  from public.room_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not public.is_room_host(v_req.room_id) then
    raise exception 'only the host can approve' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    -- Already decided. No-op so the UI can be idempotent.
    return;
  end if;

  -- Re-validate the invite at approval time. The token may have expired
  -- or been redeemed by someone else through a different path.
  select * into v_invite
  from public.room_invites
  where room_id = v_req.room_id and token = v_req.token
  for update;

  if not found then
    raise exception 'invite no longer exists' using errcode = 'P0002';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'invite expired' using errcode = '22023';
  end if;
  if v_invite.used_by is not null and v_invite.used_by <> v_req.user_id then
    raise exception 'invite already used by another user' using errcode = '22023';
  end if;

  -- Consume + insert in the same transaction.
  if v_invite.used_by is null then
    update public.room_invites
       set used_by = v_req.user_id, used_at = now()
     where id = v_invite.id;
  end if;

  insert into public.room_members (room_id, user_id, role)
  values (v_req.room_id, v_req.user_id, 'guest')
  on conflict (room_id, user_id) do nothing;

  update public.room_join_requests
     set status = 'approved',
         decided_at = now(),
         decided_by = v_uid
   where id = v_req.id;
end;
$$;

revoke all on function public.approve_join(uuid) from public;
grant execute on function public.approve_join(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 6. reject_join (host-only, soft)
-------------------------------------------------------------------------------

create or replace function public.reject_join(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.room_join_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_req
  from public.room_join_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if not public.is_room_host(v_req.room_id) then
    raise exception 'only the host can reject' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    return;
  end if;

  update public.room_join_requests
     set status = 'rejected',
         decided_at = now(),
         decided_by = v_uid
   where id = v_req.id;
end;
$$;

revoke all on function public.reject_join(uuid) from public;
grant execute on function public.reject_join(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 7. Realtime publication
-------------------------------------------------------------------------------
--
-- Make sure inserts/updates on join requests stream to subscribed clients.
-- Supabase ships with a `supabase_realtime` publication that you ADD tables to.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- ALTER PUBLICATION is idempotent for ADD when the table is already
    -- in the publication only on PG14+; we guard with IF NOT EXISTS via
    -- a try/catch to keep older databases happy.
    begin
      alter publication supabase_realtime add table public.room_join_requests;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
