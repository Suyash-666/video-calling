-- supabase/migrations/0001_realtime_auth_and_rooms.sql
--
-- Purpose:
--   1. Force every Realtime channel subscription to be from an authenticated user.
--      Without this, anyone with the project URL could join `room:<id>` channels.
--   2. Create a `rooms` table for future use (room metadata, membership, etc.).
--      We don't query it in the MVP, but it gives you a place to grow into
--      without another migration.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste this file -> Run.
--   (Or use the Supabase CLI: `supabase db push` from a linked project.)
--
-- Notes:
--   - This migration is idempotent-ish: the `drop policy if exists` lines
--     make re-runs safe; the `create policy` would fail if you re-ran the
--     file without them.
--   - The Realtime authorization policy below grants access to authenticated
--     users for ALL channels (`*`). Tighten it later (e.g. to channels named
--     `room:%`) when you want per-room ACLs.

-------------------------------------------------------------------------------
-- 1. Realtime: require authentication for all channels
-------------------------------------------------------------------------------

-- Drop any existing policy with the same name so this migration is rerunnable.
drop policy if exists "authenticated can use realtime" on realtime.messages;

-- Only allow authenticated users to read/write realtime messages.
-- The anon role will be rejected at subscribe-time, which means a
-- signed-out user can never join a `room:<id>` channel.
create policy "authenticated can use realtime"
  on realtime.messages
  for all
  to authenticated
  using ( true )
  with check ( true );

-------------------------------------------------------------------------------
-- 2. Rooms table (optional, for future use)
-------------------------------------------------------------------------------

create table if not exists public.rooms (
  id           text primary key,                 -- the room id, e.g. 'k3p9qx'
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_active  timestamptz not null default now()
);

-- Row Level Security: deny everything by default, then open the
-- minimum surface we actually need.
alter table public.rooms enable row level security;

drop policy if exists "anyone signed in can read rooms" on public.rooms;
create policy "anyone signed in can read rooms"
  on public.rooms
  for select
  to authenticated
  using ( true );

drop policy if exists "creator can insert their room" on public.rooms;
create policy "creator can insert their room"
  on public.rooms
  for insert
  to authenticated
  with check ( created_by = auth.uid() );

drop policy if exists "creator can update their room" on public.rooms;
create policy "creator can update their room"
  on public.rooms
  for update
  to authenticated
  using ( created_by = auth.uid() )
  with check ( created_by = auth.uid() );

drop policy if exists "creator can delete their room" on public.rooms;
create policy "creator can delete their room"
  on public.rooms
  for delete
  to authenticated
  using ( created_by = auth.uid() );

-- Bump last_active automatically on any UPDATE.
create or replace function public.touch_room_last_active()
returns trigger
language plpgsql
as $$
begin
  new.last_active := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_room_last_active on public.rooms;
create trigger trg_touch_room_last_active
  before update on public.rooms
  for each row execute function public.touch_room_last_active();
