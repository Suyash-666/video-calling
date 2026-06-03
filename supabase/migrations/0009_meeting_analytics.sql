-- supabase/migrations/0009_meeting_analytics.sql
--
-- Purpose:
--   Persist a small summary record for every call so the host can see
--   meeting analytics (duration, attendance, message volume) on the
--   lobby dashboard. The client builds the summary as the call winds
--   down and pushes it in one RPC at hangUp time — we deliberately
--   avoid streaming per-event rows during the call to keep network
--   chatter minimal and keep this feature purely additive.
--
-- Schema:
--   call_sessions      - one row per call. Owned by the host.
--   call_participants  - one row per (session, user) with join/leave timestamps.
--
-- Access model:
--   - The host of the room is the owner of every session for that room
--     (host_user_id = auth.uid() at session start). RLS lets the host
--     SELECT sessions + participants for their own rooms; nothing else
--     is readable. INSERTs happen via the SECURITY DEFINER RPC.
--   - Guests do NOT post their own analytics rows; the host's client is
--     the single source of truth. A future server-si
de aggregator could
--     replace this with a Realtime trigger if you need cross-host views.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

-------------------------------------------------------------------------------
-- 1. call_sessions
-------------------------------------------------------------------------------

create table if not exists public.call_sessions (
  id                uuid        primary key default gen_random_uuid(),
  room_id           text        not null references public.rooms(id) on delete cascade,
  host_user_id      uuid        not null references auth.users(id)   on delete cascade,
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  -- Convenience derived column. We could compute it on read; persisting
  -- keeps the dashboard query an O(N) SELECT instead of an O(N) plus
  -- per-row interval arithmetic.
  duration_seconds  int         not null check (duration_seconds >= 0),
  peak_participants int         not null check (peak_participants >= 1),
  message_count     int         not null default 0 check (message_count >= 0),
  created_at        timestamptz not null default now()
);

create index if not exists call_sessions_host_started_idx
  on public.call_sessions (host_user_id, started_at desc);
create index if not exists call_sessions_room_idx
  on public.call_sessions (room_id);

alter table public.call_sessions enable row level security;

drop policy if exists "host can read their call sessions" on public.call_sessions;
create policy "host can read their call sessions"
  on public.call_sessions
  for select
  to authenticated
  using ( host_user_id = auth.uid() );

-- No INSERT / UPDATE / DELETE policies. The RPC below is the only writer.

-------------------------------------------------------------------------------
-- 2. call_participants
-------------------------------------------------------------------------------

create table if not exists public.call_participants (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        not null references public.call_sessions(id) on delete cascade,
  user_id      uuid        not null references auth.users(id)            on delete cascade,
  display_name text,
  joined_at    timestamptz not null,
  -- Nullable because the client may not see a precise leave for every
  -- peer (we infer it from presence-leave; if the recording host hangs
  -- up while a peer is still present, we stamp left_at = session end).
  left_at      timestamptz,
  unique (session_id, user_id)
);

create index if not exists call_participants_session_idx
  on public.call_participants (session_id);

alter table public.call_participants enable row level security;

drop policy if exists "host can read their call participants" on public.call_participants;
create policy "host can read their call participants"
  on public.call_participants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.call_sessions s
      where s.id = session_id
        and s.host_user_id = auth.uid()
    )
  );

-- Again, no direct INSERT/UPDATE/DELETE — all writes go through the RPC.

-------------------------------------------------------------------------------
-- 3. record_call_session RPC
-------------------------------------------------------------------------------
--
-- Atomically insert the session row + all of its participants. Returns
-- the new session id so the client can navigate to a detail view later
-- if you build one.
--
-- The `p_participants` parameter is a JSONB array of objects:
--   [{ "user_id": "<uuid>", "display_name": "Alice",
--      "joined_at": "<iso>", "left_at": "<iso or null>" }, ...]
--
-- JSONB chosen over an array-of-composites because it's friendlier to
-- the supabase-js client (no manual composite-type wrangling).

create or replace function public.record_call_session(
  p_room_id           text,
  p_started_at        timestamptz,
  p_ended_at          timestamptz,
  p_peak_participants int,
  p_message_count     int,
  p_participants      jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_session uuid;
  v_dur     int;
  v_row     jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_room_host(p_room_id) then
    raise exception 'only the host can record a session' using errcode = '42501';
  end if;
  if p_started_at is null or p_ended_at is null then
    raise exception 'start and end timestamps are required' using errcode = '22023';
  end if;
  if p_ended_at < p_started_at then
    raise exception 'ended_at < started_at' using errcode = '22023';
  end if;

  v_dur := greatest(0, extract(epoch from (p_ended_at - p_started_at))::int);

  insert into public.call_sessions (
    room_id, host_user_id, started_at, ended_at,
    duration_seconds, peak_participants, message_count
  ) values (
    p_room_id, v_uid, p_started_at, p_ended_at,
    v_dur, greatest(1, p_peak_participants), greatest(0, p_message_count)
  )
  returning id into v_session;

  -- Iterate the JSONB array. coalesce on left_at == null -> session end.
  if p_participants is not null then
    for v_row in select * from jsonb_array_elements(p_participants)
    loop
      insert into public.call_participants (
        session_id, user_id, display_name, joined_at, left_at
      ) values (
        v_session,
        (v_row->>'user_id')::uuid,
        v_row->>'display_name',
        coalesce(
          (v_row->>'joined_at')::timestamptz,
          p_started_at
        ),
        coalesce(
          nullif(v_row->>'left_at', '')::timestamptz,
          p_ended_at
        )
      )
      on conflict (session_id, user_id) do nothing;
    end loop;
  end if;

  return v_session;
end;
$$;

revoke all on function public.record_call_session(
  text, timestamptz, timestamptz, int, int, jsonb
) from public;
grant execute on function public.record_call_session(
  text, timestamptz, timestamptz, int, int, jsonb
) to authenticated;
