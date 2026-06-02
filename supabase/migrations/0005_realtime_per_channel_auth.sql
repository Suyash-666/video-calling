-- supabase/migrations/0005_realtime_per_channel_auth.sql
--
-- Purpose:
--   Tighten the Realtime authorization policy so that *which channel a
--   user can subscribe to* depends on the room they're a member of.
--   This closes the last "I know the room id, I can sit on its
--   channel" gap from 0001's blanket `authenticated` policy.
--
-- How it works:
--   Realtime authorization is implemented as RLS on `realtime.messages`.
--   Each Realtime message has a `topic` (the channel name) and an
--   `extension` ('broadcast' | 'presence' | 'postgres_changes'). Inside
--   a policy, you can read the topic with `realtime.topic()` and the
--   JWT subject with `auth.uid()`.
--
--   We allow subscriptions to `room:<id>` and `messages:<id>` channels
--   only when `auth.uid()` is a member of `<id>` (per
--   `public.room_members`, gated by `is_room_member()`).
--
--   postgres_changes is NOT gated by this policy — Realtime's
--   postgres_changes path is authorized at a different layer (via
--   publication replication grants). For the `public.messages` table
--   that means a non-member can subscribe to `messages:<id>` but the
--   subscription will receive no rows, because the `SELECT` RLS on
--   `public.messages` still requires membership. So the data path
--   stays private even though the subscription itself is not.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

-------------------------------------------------------------------------------
-- Drop the old blanket policy
-------------------------------------------------------------------------------

drop policy if exists "authenticated can use realtime" on realtime.messages;

-------------------------------------------------------------------------------
-- SELECT: can I receive broadcast / presence on this channel?
-------------------------------------------------------------------------------
--
-- This applies to both broadcast messages from peers and presence
-- diffs (who joined / left). We require:
--   1. The caller is a member of the room id parsed from the topic.
--   2. The topic is one of our known shapes (`room:<id>` or `messages:<id>`).
--
-- `realtime.topic()` returns the full channel name, e.g. 'room:abc123'.
-- We extract the room id with `split_part(topic, ':', 2)`. The leading
-- prefix is purely a namespace; the membership check is on the suffix.

create policy "members can receive broadcast/presence in their rooms"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (
      split_part(realtime.topic(), ':', 1) in ('room', 'messages')
      and public.is_room_member(split_part(realtime.topic(), ':', 2))
    )
  );

-------------------------------------------------------------------------------
-- INSERT: can I broadcast / send presence on this channel?
-------------------------------------------------------------------------------
--
-- Symmetric to the SELECT policy. Presence *send* is allowed because
-- the channel-level check is the same; the docs example narrows the
-- write to `extension = 'broadcast'` only, but for our MVP a member
-- sending presence on a room they're already a member of is fine.

create policy "members can broadcast in their rooms"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (
      split_part(realtime.topic(), ':', 1) in ('room', 'messages')
      and public.is_room_member(split_part(realtime.topic(), ':', 2))
    )
  );

-------------------------------------------------------------------------------
-- Defensive: refuse other extensions we don't use
-------------------------------------------------------------------------------
--
-- Any future Realtime extension (e.g. a new kind of message) would
-- default to "deny" without an explicit policy, which is the right
-- default. The two policies above cover everything this app emits.
