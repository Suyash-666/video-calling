  -- supabase/migrations/0006_invite_expiry_rpc.sql
  --
  -- Purpose:
  --   Replace the 0004 host INSERT path on `public.room_invites` with a
  --   SECURITY DEFINER RPC that accepts a duration in seconds. The
  --   previous migration let the host INSERT directly with the column
  --   default (24 hours); now the host can choose any positive window
  --   and the server clamps invalid values.
  --
  -- Design:
  --   - The client passes `p_expires_in_seconds` (e.g. 900 for 15 min,
  --     3600 for 1 hour). The RPC computes `now() + make_interval(secs
  --     => p_expires_in_seconds)`.
  --   - We clamp the window to a sensible range:
  --       * minimum 60 seconds (1 minute) — shorter is almost certainly
  --         a UI bug
  --       * maximum 7 days — longer-lived invites can be a separate
  --         "permanent link" feature later
  --   - The RPC returns the new token so the client can show/copy it
  --     without a follow-up SELECT (which the host RLS would also
  --     allow, but this is one round trip instead of two).
  --
  -- How to apply:
  --   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.

  -------------------------------------------------------------------------------
  -- 1. RPC: create_invite(p_room_id text, p_expires_in_seconds int)
  -------------------------------------------------------------------------------

  create or replace function public.create_invite(
    p_room_id text,
    p_expires_in_seconds int default 86400   -- 24h, matches the column default
  )
  returns text
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_uid      uuid := auth.uid();
    v_token    text;
    v_seconds  int;
    v_expires  timestamptz;
  begin
    if v_uid is null then
      raise exception 'not authenticated' using errcode = '42501';
    end if;

    -- Caller must be the host of the room.
    if not public.is_room_host(p_room_id) then
      raise exception 'only the room host can create invites'
        using errcode = '42501';
    end if;

    -- Clamp the requested window.
    v_seconds := greatest(60, least(coalesce(p_expires_in_seconds, 86400), 604800));
    v_expires := now() + make_interval(secs => v_seconds);

    insert into public.room_invites (room_id, created_by, expires_at)
    values (p_room_id, v_uid, v_expires)
    returning token into v_token;

    return v_token;
  end;
  $$;

  revoke all on function public.create_invite(text, int) from public;
  grant execute on function public.create_invite(text, int) to authenticated;

  -------------------------------------------------------------------------------
  -- 2. Close the open INSERT path
  -------------------------------------------------------------------------------
  --
  -- Drop the 0004 host INSERT policy on `public.room_invites` and replace
  -- it with a narrow policy that ONLY allows the SECURITY DEFINER RPC
  -- to insert. Concretely: since the RPC runs as the function owner, it
  -- bypasses RLS. No permissive INSERT policy is needed for it to work,
  -- and we don't want one either — direct INSERTs from authenticated
  -- clients would skip the duration clamping and the host check.

  drop policy if exists "hosts can create invites" on public.room_invites;
  -- intentionally no replacement policy. create_invite() is the only path.
