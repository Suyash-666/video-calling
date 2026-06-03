-- supabase/migrations/0010_multiuse_invites.sql
--
-- Purpose:
--   Switch room_invites from single-use to multi-use, and tie invite
--   validity to the scheduled meeting's window when the room has one.
--
-- Background:
--   The 0004 migration made room_invites single-use: each token could
--   be redeemed exactly once (the `used_by` / `used_at` columns plus
--   the CHECK constraint that keeps them in lockstep). That was
--   appropriate when the only invite path was "host generates a code,
--   hands it to a single guest".
--
--   With scheduled meetings (0008), hosts want to paste one link into
--   a calendar invite and have any number of guests click it. The
--   single-use model is a poor fit:
--     - The host has no way to know how many tokens to mint ahead of
--       time.
--     - If a guest redeems the link in one tab and then a colleague
--       clicks the same link in theirs, the colleague sees "invite
--       already used" even though the host intended it for everyone.
--     - The link's natural lifetime is "while the meeting is
--       ongoing", not "until the first redemption".
--
-- Design:
--   - Drop `used_by` and `used_at`. The CHECK constraint that ties
--     them together goes with them. `redeem_invite` no longer marks
--     anything consumed.
--   - `redeem_invite` becomes idempotent: a guest who redeems the
--     same token twice (e.g. a flaky network + a retry) just gets
--     the same membership row the second time, not an error.
--   - The validity check becomes:
--       1. The invite is not past `expires_at` (still honored — a
--          hard backstop in case the meeting row is missing or the
--          host wants a short-lived link).
--       2. If the room is associated with a `scheduled_meetings`
--          row, now must be in
--             [scheduled_for - 5 minutes, scheduled_for + duration]
--          (matches the lobby's "Join" window so the link and the
--          button open/close at the same moment). The 5-minute lead
--          is also a constant here so server and client agree.
--       3. If the room is NOT associated with a meeting, only (1)
--          applies. Ad-hoc rooms still get 24-hour invites by
--          default (0004 column default; 0006's create_invite can
--          override).
--   - Membership is inserted with `on conflict do nothing`, so the
--     same guest redeeming twice or arriving via two paths is safe.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

-------------------------------------------------------------------------------
-- 1. Drop the single-use machinery
-------------------------------------------------------------------------------

-- The CHECK was added in 0004. Dropping the columns auto-drops the
-- CHECK, but we name it explicitly so the migration is self-documenting
-- and so re-runs are idempotent.
alter table public.room_invites
  drop constraint if exists room_invites_check;

alter table public.room_invites
  drop column if exists used_by;

alter table public.room_invites
  drop column if exists used_at;

-------------------------------------------------------------------------------
-- 2. Re-implement redeem_invite for multi-use + meeting-window check
-------------------------------------------------------------------------------
--
-- The previous implementation (0004) marked the invite consumed on
-- first use. This version is idempotent: a single token can mint as
-- many guest memberships as there are distinct users presenting it,
-- as long as the meeting-window check passes.
--
-- Validity:
--   - Always: invite is not past `expires_at`.
--   - If a `scheduled_meetings` row exists for this room AND isn't
--     cancelled: now must be in [scheduled_for - 5min, scheduled_for
--     + duration_minutes]. The 5-minute lead mirrors the lobby's
--     JOIN_WINDOW_LEAD_MS so a link works whenever the "Join"
--     button is enabled.
--   - A cancelled meeting: invite is rejected. Better to surface
--     "this meeting was cancelled" than to silently let guests
--     into an empty room.

create or replace function public.redeem_invite(p_room_id text, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_invite    public.room_invites%rowtype;
  v_scheduled timestamptz;
  v_duration  int;
  v_cancelled timestamptz;
  v_window_open  timestamptz;
  v_window_close timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Lock the invite row so a concurrent admin action (e.g. revoking
  -- the invite) can't race with our validation.
  select * into v_invite
    from public.room_invites
   where room_id = p_room_id and token = p_token
   for update;

  if not found then
    raise exception 'invalid invite' using errcode = 'P0002';
  end if;

  -- Hard backstop. The host may have set a short `expires_at` even
  -- on a scheduled meeting, and ad-hoc rooms have no meeting at all
  -- (so the meeting-window check below is skipped).
  if v_invite.expires_at < now() then
    raise exception 'invite expired' using errcode = '22023';
  end if;

  -- Meeting-window check. If the room is associated with a scheduled
  -- meeting that hasn't been cancelled, the link only works inside
  -- the meeting's join window.
  select scheduled_for, duration_minutes, cancelled_at
    into v_scheduled, v_duration, v_cancelled
    from public.scheduled_meetings
   where room_id = p_room_id
   limit 1;

  if found then
    if v_cancelled is not null then
      raise exception 'meeting was cancelled' using errcode = '22023';
    end if;

    v_window_open  := v_scheduled - interval '5 minutes';
    v_window_close := v_scheduled + make_interval(mins => v_duration);

    if now() < v_window_open then
      raise exception 'meeting has not started yet' using errcode = '22023';
    end if;
    if now() > v_window_close then
      raise exception 'meeting has ended' using errcode = '22023';
    end if;
  end if;

  -- Idempotent membership insert. If the user is already a member
  -- (e.g. they redeemed earlier and reloaded, or the host invited
  -- them directly via room_members), this is a no-op rather than an
  -- error. We don't track redemption count or rate; that's a future
  -- feature if abuse shows up.
  insert into public.room_members (room_id, user_id, role)
  values (p_room_id, v_uid, 'guest')
  on conflict (room_id, user_id) do nothing;

  -- NULL: no join request, membership granted directly. The
  -- waiting-room flow uses a separate path (0007's host-side
  -- approve_request); we don't gate redemption on it here.
  return null;
end;
$$;

revoke all on function public.redeem_invite(text, text) from public;
grant execute on function public.redeem_invite(text, text) to authenticated;
