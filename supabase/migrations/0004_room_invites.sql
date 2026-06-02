-- supabase/migrations/0004_room_invites.sql
--
-- Purpose:
--   Replace the open "any signed-in user can self-insert into
--   room_members" policy from 0003 with a true invite-gated join:
--   a guest must present a valid, unused, unexpired invite token
--   for the room. Hosts self-insert on room creation (no invite
--   needed) and can issue new invites for guests.
--
-- Design:
--   - `public.room_invites` is the source of truth for pending
--     invitations. Rows carry a `token`, a `room_id`, an `expires_at`,
--     and (after use) a `used_by` + `used_at`.
--   - The only way to add a row to `room_members` is via the
--     SECURITY DEFINER RPC `public.redeem_invite(...)`. Direct
--     INSERTs to `room_members` are no longer allowed.
--   - Hosts can also self-insert (when they create the room) via a
--     separate SECURITY DEFINER RPC `public.create_room_with_host()`.
--     This keeps the policy surface minimal and easy to reason about.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

-------------------------------------------------------------------------------
-- 1. room_invites
-------------------------------------------------------------------------------

create table if not exists public.room_invites (
  id          uuid        primary key default gen_random_uuid(),
  room_id     text        not null references public.rooms(id) on delete cascade,
  token       text        not null unique
                           default encode(gen_random_bytes(24), 'base64'),
  created_by  uuid        not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  used_by     uuid                 references auth.users(id) on delete set null,
  used_at     timestamptz,
  created_at  timestamptz not null default now(),
  -- A token is either unused (used_by is null) or consumed. This CHECK
  -- keeps the two states internally consistent.
  check ( (used_by is null and used_at is null)
       or (used_by is not null and used_at is not null) )
);

-- Lookups by room (host viewing outstanding invites).
create index if not exists room_invites_room_id_idx
  on public.room_invites (room_id);

-------------------------------------------------------------------------------
-- 2. Host-role helper
-------------------------------------------------------------------------------
--
-- Defined BEFORE the RLS policies below because the policies'
-- `using` / `with check` clauses reference it. Postgres evaluates
-- the policy's function reference at parse time, so the function
-- must exist when the policy is created.

create or replace function public.is_room_host(p_room_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.room_members
    where room_id = p_room_id
      and user_id = auth.uid()
      and role = 'host'
  );
$$;

revoke all on function public.is_room_host(text) from public;
grant execute on function public.is_room_host(text) to authenticated;

-------------------------------------------------------------------------------
-- 3. room_invites RLS
-------------------------------------------------------------------------------

alter table public.room_invites enable row level security;

-- Hosts of a room can see all invites for that room (pending + used).
drop policy if exists "hosts can read their room invites" on public.room_invites;
create policy "hosts can read their room invites"
  on public.room_invites
  for select
  to authenticated
  using ( public.is_room_host(room_id) );

-- Hosts can issue invites.
drop policy if exists "hosts can create invites" on public.room_invites;
create policy "hosts can create invites"
  on public.room_invites
  for insert
  to authenticated
  with check (
    public.is_room_host(room_id)
    and created_by = auth.uid()
  );

-- No UPDATE policy at all: invite rows are write-once. The RPC marks
-- them used via a SECURITY DEFINER update.
-- No DELETE policy: drop the room (cascade) to clear invites.

-------------------------------------------------------------------------------
-- 4. Create-room RPC (host self-insert)
-------------------------------------------------------------------------------
--
-- A host who creates a room must atomically:
--   1. Insert the rooms row (if missing), owned by them.
--   2. Insert a room_members row naming themselves as host.
-- This replaces the old "any signed-in user can insert into
-- room_members" path for first-time joins.

create or replace function public.create_room_with_host(p_room_id text)
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

  -- Insert the room if it doesn't exist. ignoreDuplicates semantics
  -- via ON CONFLICT DO NOTHING keep this safe to call twice.
  insert into public.rooms (id, created_by)
  values (p_room_id, v_uid)
  on conflict (id) do nothing;

  -- Add the caller as host (no-op if already a member).
  insert into public.room_members (room_id, user_id, role)
  values (p_room_id, v_uid, 'host')
  on conflict (room_id, user_id) do nothing;
end;
$$;

revoke all on function public.create_room_with_host(text) from public;
grant execute on function public.create_room_with_host(text) to authenticated;

-------------------------------------------------------------------------------
-- 5. Redeem-invite RPC
-------------------------------------------------------------------------------
--
-- The ONLY way for a non-host to add themselves to room_members.
-- Validates the token against the room, checks expiry and prior use,
-- marks the invite consumed, and inserts the membership row — all in
-- one transaction.

create or replace function public.redeem_invite(p_room_id text, p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.room_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Lock the invite row so two concurrent redemptions can't both win.
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

  -- Mark the invite consumed FIRST so a partial failure doesn't leave
  -- a usable token behind.
  update public.room_invites
     set used_by = v_uid, used_at = now()
   where id = v_invite.id;

  -- Insert the membership. on conflict do nothing covers the case
  -- where the user is somehow already a member.
  insert into public.room_members (room_id, user_id, role)
  values (p_room_id, v_uid, 'guest')
  on conflict (room_id, user_id) do nothing;
end;
$$;

revoke all on function public.redeem_invite(text, text) from public;
grant execute on function public.redeem_invite(text, text) to authenticated;

-------------------------------------------------------------------------------
-- 6. Close the old room_members INSERT path
-------------------------------------------------------------------------------
--
-- The 0003 policy `users can join rooms as themselves` is now unsafe
-- (any signed-in user could self-insert into any room). The only
-- valid path forward is the SECURITY DEFINER RPC above, which runs
-- as the function owner and bypasses RLS.
--
-- We drop the old policy and DO NOT replace it with a permissive one.
-- The result: direct INSERTs to room_members are denied for everyone,
-- and only the RPCs above can add rows.

drop policy if exists "users can join rooms as themselves" on public.room_members;
-- intentionally no replacement policy here.
