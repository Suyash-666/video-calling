-- supabase/migrations/0008_scheduled_meetings.sql
--
-- Purpose:
--   Lightweight scheduling. A scheduled_meeting is a *promise* of a room
--   at some future time. It reserves a room id (slug), and at start time
--   the creator clicks "Join" which runs the same create_room_with_host
--   RPC the lobby's "Create Room" button does today. Guests get the
--   pre-minted invite link the host issued at scheduling time.
--
-- Design choices:
--   - The meeting OWNS its room slug. We allocate a fresh slug at
--     create-time (`mtg-<short-id>`) so the dashboard "Join" never
--     collides with an ad-hoc room someone made manually.
--   - No `rooms` row is inserted on schedule. The rooms row is created
--     lazily on Join (via create_room_with_host). This keeps the
--     existing "the host opens the door" semantics intact.
--   - Invite links work as-is: the host can mint one or more invites
--     after the room exists. To make this dashboard-friendly, we also
--     expose `create_meeting_with_invite` which performs the rare
--     "schedule + pre-mint a long-lived invite" combo so the host can
--     paste a link into their calendar invite right away.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

-------------------------------------------------------------------------------
-- 1. scheduled_meetings
-------------------------------------------------------------------------------

create table if not exists public.scheduled_meetings (
  id               uuid        primary key default gen_random_uuid(),
  -- The slug the meeting will use when it starts. Generated at create
  -- time so the invite link is stable. Globally unique.
  room_id          text        not null unique,
  title            text        not null,
  -- The wall-clock instant the meeting is supposed to begin. Stored as
  -- timestamptz so client-side rendering can do its own tz conversion.
  scheduled_for    timestamptz not null,
  duration_minutes int         not null default 30
                                check (duration_minutes between 5 and 24 * 60),
  created_by       uuid        not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  cancelled_at     timestamptz
);

create index if not exists scheduled_meetings_by_owner_idx
  on public.scheduled_meetings (created_by, scheduled_for desc);
create index if not exists scheduled_meetings_by_time_idx
  on public.scheduled_meetings (scheduled_for);

alter table public.scheduled_meetings enable row level security;

-- A user can read their OWN scheduled meetings. We don't expose other
-- users' meetings here — a separate "shared with me" mechanism would
-- live in its own table. Invitees see the meeting via the invite link
-- they were given, not by querying this table.
drop policy if exists "owner can read their meetings" on public.scheduled_meetings;
create policy "owner can read their meetings"
  on public.scheduled_meetings
  for select
  to authenticated
  using ( created_by = auth.uid() );

-- No direct INSERT / UPDATE / DELETE policies. All writes go through
-- the SECURITY DEFINER RPCs below.

-------------------------------------------------------------------------------
-- 2. Slug generator
-------------------------------------------------------------------------------
--
-- 8 random base32-ish chars prefixed with `mtg-`. Collision probability
-- is negligible at our scale; we still retry once on the off chance.

create or replace function public.generate_meeting_slug()
returns text
language plpgsql
volatile
as $$
declare
  -- Lowercase letters + digits, no look-alikes (0/o/1/l).
  v_chars text := 'abcdefghijkmnpqrstuvwxyz23456789';
  v_slug  text;
  v_tries int := 0;
begin
  loop
    v_tries := v_tries + 1;
    v_slug := 'mtg-';
    for i in 1..8 loop
      v_slug := v_slug || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    end loop;

    -- Re-roll on collision; bail after 5 tries (would imply we exhausted
    -- the 32^8 space, which means we have bigger problems).
    perform 1 from public.scheduled_meetings where room_id = v_slug;
    if not found then
      return v_slug;
    end if;
    if v_tries >= 5 then
      raise exception 'could not generate unique slug' using errcode = '23505';
    end if;
  end loop;
end;
$$;

-------------------------------------------------------------------------------
-- 3. create_scheduled_meeting
-------------------------------------------------------------------------------

create or replace function public.create_scheduled_meeting(
  p_title            text,
  p_scheduled_for    timestamptz,
  p_duration_minutes int default 30
)
returns public.scheduled_meetings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_slug text;
  v_row  public.scheduled_meetings%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_scheduled_for is null then
    raise exception 'scheduled_for is required' using errcode = '22023';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title is required' using errcode = '22023';
  end if;

  v_slug := public.generate_meeting_slug();

  insert into public.scheduled_meetings (
    room_id, title, scheduled_for, duration_minutes, created_by
  ) values (
    v_slug, trim(p_title), p_scheduled_for, p_duration_minutes, v_uid
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_scheduled_meeting(text, timestamptz, int) from public;
grant execute on function public.create_scheduled_meeting(text, timestamptz, int) to authenticated;

-------------------------------------------------------------------------------
-- 4. cancel_scheduled_meeting
-------------------------------------------------------------------------------
--
-- Soft delete: sets `cancelled_at`. We keep the row so a stale invite
-- link surfaces a "this meeting was cancelled" message instead of
-- silently letting the guest into a fresh empty room with the slug.

create or replace function public.cancel_scheduled_meeting(p_id uuid)
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

  update public.scheduled_meetings
     set cancelled_at = now()
   where id = p_id
     and created_by = v_uid
     and cancelled_at is null;

  if not found then
    raise exception 'meeting not found or not yours' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.cancel_scheduled_meeting(uuid) from public;
grant execute on function public.cancel_scheduled_meeting(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 5. create_meeting_with_invite
-------------------------------------------------------------------------------
--
-- Convenience: schedule + create the room shell + mint a long-lived
-- invite token in one atomic call. Returns both the meeting row and
-- the invite token so the dashboard can show a copy-link button
-- immediately, without the host having to "open" the room first.
--
-- The room is created here (vs lazily on Join) because invite tokens
-- have a FK to rooms.id. We still leave the host's membership row to
-- be inserted by the regular Join flow's create_room_with_host call.

create or replace function public.create_meeting_with_invite(
  p_title            text,
  p_scheduled_for    timestamptz,
  p_duration_minutes int default 30
) returns table (
  meeting_id    uuid,
  room_id       text,
  invite_token  text,
  expires_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_meeting public.scheduled_meetings%rowtype;
  v_expires timestamptz;
  v_token   text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_meeting := public.create_scheduled_meeting(
    p_title, p_scheduled_for, p_duration_minutes
  );

  -- Create the rooms shell so the invite FK is satisfied.
  insert into public.rooms (id, created_by)
  values (v_meeting.room_id, v_uid)
  on conflict (id) do nothing;

  -- The host needs to be a member to satisfy is_room_host inside the
  -- invites INSERT policy. The Join flow will also call this; the
  -- on-conflict makes it safe.
  insert into public.room_members (room_id, user_id, role)
  values (v_meeting.room_id, v_uid, 'host')
  on conflict (room_id, user_id) do nothing;

  -- Default lifetime: scheduled start + duration + 1 hour grace.
  v_expires := p_scheduled_for
             + (p_duration_minutes || ' minutes')::interval
             + interval '1 hour';

  insert into public.room_invites (room_id, created_by, expires_at)
  values (v_meeting.room_id, v_uid, v_expires)
  returning token, expires_at into v_token, v_expires;

  meeting_id   := v_meeting.id;
  room_id      := v_meeting.room_id;
  invite_token := v_token;
  expires_at   := v_expires;
  return next;
end;
$$;

revoke all on function public.create_meeting_with_invite(text, timestamptz, int) from public;
grant execute on function public.create_meeting_with_invite(text, timestamptz, int) to authenticated;
