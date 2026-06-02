-- supabase/migrations/0003_room_members.sql
--
-- Purpose:
--   Add per-room membership so that:
--     - Only members of a room can read its chat history
--     - Only members of a room can INSERT a message into it
--     - Anyone with the room id can still *attempt* to join, but the
--       RLS on the `room_members` write is what enforces the boundary
--       in the client path. (For true private rooms you'd add an
--       invite/approval flow on top of this; out of scope for the MVP.)
--
-- This migration also tightens the existing `public.rooms` and
-- `public.messages` RLS policies to require membership, and replaces
-- the temporary "any signed-in user" read policies from earlier
-- migrations.
--
-- How to apply:
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

-------------------------------------------------------------------------------
-- 1. room_members
-------------------------------------------------------------------------------

create table if not exists public.room_members (
  room_id    text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  role       text        not null check ( role in ('host', 'guest') ),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

-- Lookup by user (for "list my rooms") is the next most common query.
create index if not exists room_members_user_id_idx
  on public.room_members (user_id);

-------------------------------------------------------------------------------
-- 2. Helper: am I a member of this room?
-------------------------------------------------------------------------------
--
-- A SECURITY DEFINER function so RLS policies on *other* tables can ask
-- the question without recursing into room_members' own RLS.

create or replace function public.is_room_member(p_room_id text)
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
  );
$$;

-- Only the table owner (typically postgres) should be able to call this
-- with elevated rights; we revoke from public and grant to authenticated.
revoke all on function public.is_room_member(text) from public;
grant execute on function public.is_room_member(text) to authenticated;

-------------------------------------------------------------------------------
-- 3. Tighten rooms RLS
-------------------------------------------------------------------------------

-- The old "anyone signed in can read rooms" policy from 0001 was a
-- placeholder; replace it with membership-scoped reads.
drop policy if exists "anyone signed in can read rooms" on public.rooms;
create policy "members can read their room"
  on public.rooms
  for select
  to authenticated
  using ( public.is_room_member(id) );

-- The creator can still insert (this is unchanged from 0001).
-- We keep the original policy name for clarity.
drop policy if exists "creator can insert their room" on public.rooms;
create policy "creator can insert their room"
  on public.rooms
  for insert
  to authenticated
  with check ( created_by = auth.uid() );

-- The creator can still update (unchanged).
drop policy if exists "creator can update their room" on public.rooms;
create policy "creator can update their room"
  on public.rooms
  for update
  to authenticated
  using ( created_by = auth.uid() )
  with check ( created_by = auth.uid() );

-- The creator can still delete (unchanged).
drop policy if exists "creator can delete their room" on public.rooms;
create policy "creator can delete their room"
  on public.rooms
  for delete
  to authenticated
  using ( created_by = auth.uid() );

-------------------------------------------------------------------------------
-- 4. room_members RLS
-------------------------------------------------------------------------------

alter table public.room_members enable row level security;

-- Members can see other members of rooms they belong to.
drop policy if exists "members can read other members" on public.room_members;
create policy "members can read other members"
  on public.room_members
  for select
  to authenticated
  using ( public.is_room_member(room_id) );

-- A user can join a room by inserting a row naming themselves.
-- For the MVP, joining is open to any authenticated user — that is
-- the "I have the room id" check. Tighten with an invite flow later
-- (e.g. require a `room_invites` table and a check on the invite).
drop policy if exists "users can join rooms as themselves" on public.room_members;
create policy "users can join rooms as themselves"
  on public.room_members
  for insert
  to authenticated
  with check ( user_id = auth.uid() );

-- A host can remove a guest; a user can remove themselves.
drop policy if exists "host or self can remove members" on public.room_members;
create policy "host or self can remove members"
  on public.room_members
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.room_members m
      where m.room_id = room_members.room_id
        and m.user_id = auth.uid()
        and m.role = 'host'
    )
  );

-- No UPDATE: roles are assigned at insert and not editable through the API.

-------------------------------------------------------------------------------
-- 5. Tighten messages RLS to require membership
-------------------------------------------------------------------------------

drop policy if exists "signed-in users can read messages" on public.messages;
create policy "members can read room messages"
  on public.messages
  for select
  to authenticated
  using ( public.is_room_member(room_id) );

-- The INSERT policy from 0002 already requires user_id = auth.uid();
-- tighten it further to require the sender to be a member of the room.
drop policy if exists "users can insert their own messages" on public.messages;
create policy "members can insert their own messages"
  on public.messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_room_member(room_id)
  );

-------------------------------------------------------------------------------
-- 6. Cascade: when a room row is deleted, drop its members.
-------------------------------------------------------------------------------

alter table public.room_members
  drop constraint if exists room_members_room_id_fkey;

alter table public.room_members
  add constraint room_members_room_id_fkey
  foreign key (room_id) references public.rooms(id) on delete cascade;
