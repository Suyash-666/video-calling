-- supabase/migrations/0011_realtime_membership_notify.sql
--
-- Purpose:
--   Force every existing Realtime WebSocket to re-evaluate its
--   per-connection RLS predicate whenever `room_members` changes.
--   Closes the "joiner is invisible to existing peers" race that
--   `verifyMembership` (in the client) cannot close on its own.
--
-- Why this is needed:
--   The Realtime authorization policy (0005) is implemented as RLS on
--   `realtime.messages`. Supabase Realtime evaluates the RLS predicate
--   for a topic and CACHES the result for the lifetime of the
--   WebSocket. New `room_members` rows inserted after the connection
--   was established do NOT automatically invalidate the cache — the
--   existing peer keeps treating the new joiner as "not a member" and
--   silently drops their broadcasts/presence.
--   `verifyMembership` in the client only confirms the joiner's OWN
--   view; it cannot poke the host's WebSocket. The fix lives in the
--   database.
--
--   NOTIFY `pgrst` reloads the PostgREST schema cache, but Realtime
--   has its own subscription: `NOTIFY realtime, '<channel_topic>'`.
--   Sending the channel topic as the payload asks the Realtime server
--   to re-check authorization for that specific topic on every
--   connected WebSocket. (See Supabase docs: "Realtime Authorization".)
--
-- Why a trigger, not a NOTIFY in the RPC:
--   `room_members` can change from any code path:
--     - create_room_with_host (host insert)
--     - redeem_invite (guest insert, possibly via waiting room)
--     - approve_join (waiting room path)
--     - the host or the user themselves via DELETE
--   Adding a NOTIFY to each of those is fragile. A single trigger
--   covers every write, present and future.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   Then redeploy the client (Vercel picks up the change automatically
--   on next push, or you can also use `NOTIFY` from the SQL editor to
--   apply it ad-hoc to running WebSockets).

-------------------------------------------------------------------------------
-- 1. NOTIFY helper
-------------------------------------------------------------------------------
--
-- `realtime.send` is a Supabase-internal helper that publishes a
-- notification to the realtime server, which in turn re-evaluates the
-- RLS predicate for the given topic on all connected WebSockets.
-- The function exists in Supabase projects; if it doesn't on a vanilla
-- Postgres, the trigger simply no-ops, which is safe — Realtime would
-- still pick up the new row on the next reconnect / heartbeat refresh.
-- We guard with to_regprocedure so the migration is portable.

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'realtime' and p.proname = 'send'
  ) then
    execute $f$
      create or replace function public._realtime_notify_membership()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_room text;
      begin
        v_room := coalesce(new.room_id, old.room_id);
        -- Payload format: '<topic>' asks Realtime to re-check that
        -- specific topic on every WebSocket. Multiple WebSockets may
        -- be subscribed to `room:<v_room>` and `messages:<v_room>`,
        -- so we send both. The server no-ops for clients not
        -- subscribed to the topic.
        perform realtime.send('room:' || v_room);
        perform realtime.send('messages:' || v_room);
        return coalesce(new, old);
      end;
      $body$;
    $f$;
  end if;
end $$;

-- Create the trigger only if the helper function was created above.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = '_realtime_notify_membership'
  ) then
    drop trigger if exists room_members_realtime_notify on public.room_members;
    create trigger room_members_realtime_notify
      after insert or update or delete
      on public.room_members
      for each row
      execute function public._realtime_notify_membership();
  end if;
end $$;

-- Belt-and-suspenders: if a previous half-run of 0011 left the helper
-- but the trigger wasn't created (e.g. room_join_requests didn't exist
-- yet), make sure the room_members trigger is installed once we reach
-- a point where everything's present. This block is a no-op when
-- everything's already in place.
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'room_members_realtime_notify'
  ) and to_regclass('public.room_members') is not null
    and to_regprocedure('public._realtime_notify_membership()') is not null
  then
    create trigger room_members_realtime_notify
      after insert or update or delete
      on public.room_members
      for each row
      execute function public._realtime_notify_membership();
  end if;
end $$;

-------------------------------------------------------------------------------
-- 2. Same for room_join_requests (waiting room flow)
-------------------------------------------------------------------------------
--
-- When a host enables / disables the waiting room, the policy result
-- for `room:<id>` topics can flip. When a join request is decided, the
-- guest's subsequent subscription needs to see the new membership.
-- We re-notify the same channels.

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.proname = '_realtime_notify_membership'
  ) then
    execute $f$
      create or replace function public._realtime_notify_requests()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_room text;
      begin
        v_room := coalesce(new.room_id, old.room_id);
        perform realtime.send('room:' || v_room);
        return coalesce(new, old);
      end;
      $body$;
    $f$;

    -- room_join_requests was added in 0007 and may not exist on
    -- projects that were bootstrapped before 0007 was applied. Guard
    -- with to_regclass so this migration is safe to run on any state.
    if to_regclass('public.room_join_requests') is not null then
      drop trigger if exists room_join_requests_realtime_notify on public.room_join_requests;
      create trigger room_join_requests_realtime_notify
        after insert or update or delete
        on public.room_join_requests
        for each row
        execute function public._realtime_notify_requests();
    end if;
  end if;
end $$;

-------------------------------------------------------------------------------
-- 3. rooms.waiting_room_enabled changes
-------------------------------------------------------------------------------
--
-- Flipping the flag can deny/allow future joins but does NOT invalidate
-- existing WebSocket caches. We re-notify so existing connections
-- re-evaluate the RLS predicate on `room:<id>` topics.

do $$
begin
  if to_regprocedure('public._realtime_notify_membership()') is not null
    and to_regclass('public.rooms') is not null
  then
    execute $f$
      create or replace function public._realtime_notify_rooms()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      begin
        perform realtime.send('room:' || new.id);
        return new;
      end;
      $body$;
    $f$;

    drop trigger if exists rooms_realtime_notify on public.rooms;
    create trigger rooms_realtime_notify
      after update of waiting_room_enabled
      on public.rooms
      for each row
      when (old.waiting_room_enabled is distinct from new.waiting_room_enabled)
      execute function public._realtime_notify_rooms();
  end if;
end $$;
