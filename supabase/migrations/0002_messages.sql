-- supabase/migrations/0002_messages.sql
--
-- Purpose:
--   Add a `public.messages` table for chat history, plus RLS so that
--   - any signed-in user can SELECT messages in rooms they have access to
--   - a user can only INSERT a message that names *them* as the author
--   - users cannot UPDATE or DELETE messages (chat is append-only)
--
-- Note on access control for this MVP:
--   We do not yet have a `room_members` join table, so we use a
--   simple "any authenticated user can read any room's messages"
--   policy. When you add per-room membership, tighten the SELECT
--   policy to check that `auth.uid()` appears in `room_members` for
--   that room id. The table is shaped so the upgrade is local to
--   the SELECT policy.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

-------------------------------------------------------------------------------
-- Table
-------------------------------------------------------------------------------

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     text        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  text        text        not null check ( length(text) > 0 and length(text) <= 2000 ),
  created_at  timestamptz not null default now()
);

-- Composite index for the most common query: "give me the latest N
-- messages in this room, oldest first".
create index if not exists messages_room_id_created_at_idx
  on public.messages (room_id, created_at desc);

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------

alter table public.messages enable row level security;

-- Anyone signed in can read messages. Tighten when you add room_members.
drop policy if exists "signed-in users can read messages" on public.messages;
create policy "signed-in users can read messages"
  on public.messages
  for select
  to authenticated
  using ( true );

-- A user can only insert a message naming themselves as the author.
-- `auth.uid()` is the JWT's `sub` claim, which the Supabase client
-- sets automatically on the WebSocket upgrade.
drop policy if exists "users can insert their own messages" on public.messages;
create policy "users can insert their own messages"
  on public.messages
  for insert
  to authenticated
  with check ( user_id = auth.uid() );

-- Append-only: no UPDATE or DELETE policies. That means a malicious
-- client can never rewrite or delete history.

-------------------------------------------------------------------------------
-- Realtime: enable postgres_changes for the messages table
-------------------------------------------------------------------------------
--
-- The Supabase JS client subscribes to row-level changes via
-- `channel.on('postgres_changes', { event: 'INSERT', schema: 'public',
-- table: 'messages', filter: 'room_id=eq.<id>' }, ...)`. For that to
-- work, the table has to be part of the `supabase_realtime` publication.
--
-- On a new Supabase project the publication already exists; the lines
-- below add our table to it. `drop ... if exists` makes them rerunnable.

alter publication supabase_realtime add table public.messages;
