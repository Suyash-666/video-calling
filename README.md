# Zoom Mini — 1:1 Video Call on Supabase Realtime + Auth + Postgres

A deliberately tiny Zoom clone: React + TypeScript + Vite + Tailwind on
the front end, **Supabase Realtime** as the signaling channel,
**Supabase Auth** for sign-in, **Supabase Postgres** for chat history,
and WebRTC for the peer-to-peer media. Built for **2 users in 1 room**.
No Express, no Socket.IO server, no third-party auth, no third-party
database. Just enough to get a working, gated, persistent video call —
on a single platform.

---

## Why Supabase?

The whole signaling layer (offers, answers, ICE candidates, chat) rides
on a single Supabase Realtime channel. We **don't** run an Express
server, we **don't** use Edge Functions, and we **don't** touch
Postgres. Supabase is just a global WebSocket pub/sub bus we lean on.

| Old (Express + Socket.IO) | New (Supabase Realtime) |
|---|---|
| `socket.to(roomId).emit('offer', ...)` | `channel.send({ type: 'broadcast', event: 'offer', payload })` |
| `socket.on('offer', ...)` | `channel.on('broadcast', { event: 'offer' }, ...)` |
| "Who else is in the room?" — custom server state | `channel.presenceState()` |
| "Did the peer leave?" — `disconnect` handler | `channel.on('presence', { event: 'leave' })` |

The WebRTC media path is unchanged. Audio and video still flow
peer-to-peer; Supabase is not in the media path.

---

## 1. Folder layout

```
zoom-mini/
├── README.md
├── .gitignore
├── vercel.json            # Vercel build config (root dir, SPA rewrite, asset cache)
├── supabase/
│   └── migrations/
│       ├── 0001_realtime_auth_and_rooms.sql
│       ├── 0002_messages.sql
│       ├── 0003_room_members.sql
│       ├── 0004_room_invites.sql
│       ├── 0005_realtime_per_channel_auth.sql
│       └── 0006_invite_expiry_rpc.sql
└── client/                # React + Vite + Tailwind app
    ├── package.json
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── tsconfig.json
    ├── .env.example       # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
    └── src/
        ├── main.tsx       # mounts <App /> inside <AuthProvider>
        ├── App.tsx        # top-level layout (gates on auth)
        ├── index.css      # Tailwind directives
        ├── types.ts       # shared TypeScript types
        ├── lib/
        │   ├── supabase.ts   # createClient + roomChannel helper
        │   └── auth.tsx      # AuthProvider + useAuth hook
        ├── hooks/
        │   └── useWebRTC.ts  # the entire WebRTC dance on Realtime
        └── components/
            ├── AuthScreen.tsx# sign in / sign up
            ├── Lobby.tsx     # pre-call screen (Join or Create)
            ├── VideoTile.tsx # <video> with label
            ├── ControlBar.tsx# mute / cam / hangup
            └── ChatPanel.tsx # slide-in side chat (with history)
```

> The previous `server/` directory has been removed entirely. The
> client is now a self-contained bundle that talks directly to Supabase.

---

## 2. Setup

### 2.1 Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Once it's provisioned, open **Project Settings → API** and copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`
3. In **Authentication → Providers**, make sure **Email** is enabled
   (it is by default). If you want zero-friction local testing, you
   can disable **Confirm email** while developing; turn it back on
   for production.

### 2.2 Apply the SQL migrations (auth + rooms + chat history + membership + invites)

Open **SQL Editor → New query** in the Supabase dashboard, then paste
and run each file in order:

1. `supabase/migrations/0001_realtime_auth_and_rooms.sql`
   - Adds a Realtime authorization policy that **rejects anonymous
     channel subscriptions**. After this, only signed-in users can
     subscribe to `room:<id>` channels.
   - Creates a `public.rooms` table for future use (room metadata,
     membership). The MVP doesn't query it directly yet.
2. `supabase/migrations/0002_messages.sql`
   - Creates a `public.messages` table for chat history.
   - RLS: any signed-in user can read; a user can only insert rows
     naming themselves as the author; no one can update or delete
     (chat is append-only).
   - Adds `public.messages` to the `supabase_realtime` publication so
     `postgres_changes` events fire for inserts.
3. `supabase/migrations/0003_room_members.sql`
   - Creates a `public.room_members` table keyed by `(room_id, user_id)`
     with a `host | guest` role.
   - Tightens the RLS on `messages`, `rooms`, and `room_members` so
     that only members of a room can read or write to it. A signed-in
     user can still *join* any room by inserting themselves as
     `guest` — that is the "I have the room id" check. Replace with
     an invite flow when you need true private rooms.
4. `supabase/migrations/0004_room_invites.sql`
   - Creates a `public.room_invites` table (`token, room_id, created_by,
     expires_at, used_by, used_at`).
   - Adds two `SECURITY DEFINER` RPCs — `create_room_with_host` and
     `redeem_invite` — and removes the open `INSERT` policy on
     `room_members`. The RPCs are the only paths the server allows
     for writing to `room_members`. The guest path requires a valid
     unused unexpired invite token.
5. `supabase/migrations/0005_realtime_per_channel_auth.sql`
   - Replaces the blanket `authenticated can use realtime` policy from
     `0001` with two narrow policies on `realtime.messages`. The new
     policies read the channel name via `realtime.topic()` and the JWT
     subject via `auth.uid()`, and only allow `broadcast` and
     `presence` traffic on `room:<id>` / `messages:<id>` channels when
     the caller is a member of `<id>`. `postgres_changes` is gated
     separately by the underlying table's RLS, not by Realtime's policy
     layer.
6. `supabase/migrations/0006_invite_expiry_rpc.sql`
   - Replaces the open `INSERT` policy on `public.room_invites` from
     `0004` with a `create_invite(p_room_id, p_expires_in_seconds)`
     SECURITY DEFINER RPC. The RPC clamps the requested window to
     1 minute .. 7 days, checks that the caller is the room host, and
     returns the new token in one round trip.

### 2.3 Configure the client

```bash
cd zoom-mini/client
cp .env.example .env.local
# edit .env.local and paste your URL + anon key
npm install
npm run dev
```

Vite will print something like `http://localhost:5173`.

### 2.4 Make a call

1. Open `http://localhost:5173`. The **Auth screen** appears first.
2. In **Tab 1**, click **Create account**, enter an email + password
   (min 6 chars), submit. If email confirmation is on, check the
   inbox and click the link — then sign in. If it's off, you're
   signed in immediately.
3. In the **Lobby**, click **Create Room**. Allow camera + mic. The
   header shows the new id (e.g. `k3p9qx`) and a green **HOST** badge.
4. In **Tab 1**'s header, click **📨 Invite**. A token is generated
   and copied to your clipboard. Paste it somewhere (Notes app,
   chat, etc.) — the guest will need it.
5. In **Tab 2** (or another browser, or incognito), sign in with a
   *different* email. Check **I have an invite code**, paste the
   token, type the room id, and click **Join Room**.
6. Within ~1 second the remote video appears in both tabs and audio
   flows. The guest's header shows a **GUEST** badge. Use the
   Mute / Camera off / Hang up buttons as needed.

> **Heads up:** `getUserMedia` requires a **secure context** for
> remote hosts (HTTPS or `localhost`). `http://localhost:5173`
> qualifies.

### 2.5 Use the chat

While in a call, click the **💬 Chat** tab on the right edge to open
a slide-in chat panel. The panel:

- Loads the **last 50 messages** for the room from `public.messages`
  when you join — refresh the page or re-join the room later and your
  history is still there.
- Subscribes to new inserts via Realtime's `postgres_changes` filtered
  by `room_id`, so messages from the other peer (or from other tabs of
  the same user) appear in real time.
- Sends by **inserting a row** in `public.messages`. RLS makes sure
  the row's `user_id` matches your authenticated session — the client
  can't lie about who sent a message.

---

## 3. Deploy to Vercel

The whole thing is a static Vite app — no server, no functions, no
Edge Functions, no environment-specific build steps. The repo
includes a `vercel.json` at the root with the build settings and
an SPA rewrite, so you can deploy with one click.

### 3.1 One-time: push to GitHub

```bash
cd zoom-mini
git init -b main             # only the first time
git add -A
git commit -m "Initial deploy"
gh repo create zoom-mini --public --source=. --remote=origin --push
# or: create the repo on github.com, then:
#   git remote add origin git@github.com:<you>/zoom-mini.git
#   git push -u origin main
```

### 3.2 Import into Vercel

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import the `zoom-mini` repo.
3. **Root Directory** → click **Edit** → set to `client`. This is
   the most common gotcha: Vercel's auto-detection sees the
   `package.json` at the repo root (`zoom-mini/package.json`) and
   will fail to build unless you point it at `client/`.
4. Framework Preset should auto-detect as **Vite**. If not, select it.
5. **Environment Variables** — add both, picking values from
   **Production**, **Preview**, and **Development** (toggle all
   three on if you want to test on Preview URLs before promoting):
   - `VITE_SUPABASE_URL` — `https://<project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` — the `anon` `public` key from
     **Project Settings → API**
6. Click **Deploy**. The first build takes ~1 minute. When it's
   done you'll get a URL like `https://zoom-mini-<hash>.vercel.app`.

### 3.3 Smoke-test the deployed app

1. Open the Vercel URL in **Tab 1**. Create an account, then
   **Create Room**. Allow camera + mic. The green **HOST** badge
   should appear in the header.
2. In **Tab 2** (different browser, or incognito), open the same
   URL. Sign up a different email. Check **I have an invite code**,
   paste a token from Tab 1's 📨 Invite button, click **Join Room**.
3. The remote video should appear in both tabs within ~1 second.
4. Open the 💬 Chat tab in both tabs and exchange a message.
5. Refresh Tab 2 — the chat history should still be there.

### 3.4 Troubleshoot

| Symptom | Likely cause | Fix |
|---|---|---|
| Blank page on the deployed URL | Vercel built the wrong directory | Project Settings → General → **Root Directory** = `client`, then redeploy |
| `Supabase env vars are missing` amber warning on the deployed site | Env vars not set in Vercel (or names misspelled) | Project Settings → Environment Variables. Names must be **exactly** `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the `VITE_` prefix is required for Vite to expose them). Redeploy after changing them. |
| `CHANNEL_ERROR` on Join Room | Migrations not applied (or applied to wrong project) | Re-check the Supabase project the URL points to. Open SQL Editor → run the function-check query from section 2.3 above. |
| Webcam works locally but not on the deployed URL | Browser blocked the camera because the Vercel preview URL isn't HTTPS | The default `*.vercel.app` URL is HTTPS so this shouldn't happen. If you're using a custom domain, make sure it's served over HTTPS — `getUserMedia` requires a secure context. |
| Chat history empty after refresh | RLS denied the read | Verify all six migrations ran in order. The most common cause is `0003` (room_members) or `0005` (realtime per-channel auth) being missing. |
| "Could not create invite: function public.create_invite(text, integer) does not exist" | `0006` didn't apply | Re-run `0006_invite_expiry_rpc.sql` in SQL Editor. |
| Invite button does nothing | Click-outside effect closing the panel on open click | Already fixed in `App.tsx` — `inviteWrapperRef` + `mousedown` listener. Hard-refresh the deployed site (`Ctrl+Shift+R` / `Cmd+Shift+R`) to pick up the new build. |

### 3.5 Environment variables reference

The Vite client reads two env vars at **build time**. They become
part of the JS bundle (the anon key is designed for this — it is
gated by RLS on the server). If you change them, you must redeploy
— Vite does not read `.env` at runtime in production.

| Name | Where it comes from | Used by |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → **Project URL** | `lib/supabase.ts` |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → **anon public** key | `lib/supabase.ts` |

Never put the `service_role` key in a `VITE_*` env var — that key
bypasses RLS and would expose all your data to the world.

---

## 4. File-by-file explanation

### `client/src/lib/supabase.ts`
- One shared `createClient` against your Supabase project.
- `roomChannel(roomId)` returns a `RealtimeChannel` named
  `room:<id>` with:
  - `broadcast.self: false` — we never receive our own messages back,
    which simplifies the WebRTC hook.
  - `presence.key` — a per-tab UUID that uniquely identifies each
    peer in the room (used to decide who's the caller).
- The same client automatically attaches the current user's JWT to
  Realtime WebSocket connections. That's what the SQL migration's
  Realtime authorization policy verifies.

### `client/src/lib/auth.tsx`
- `AuthProvider` wraps the app in `main.tsx` and exposes the current
  session via context. On mount it calls `supabase.auth.getSession()`
  to restore the user from localStorage, then subscribes to
  `onAuthStateChange` to stay in sync on login / logout / token
  refresh.
- `useAuth()` returns `{ user, session, loading, signIn, signUp, signOut }`.
- Sign-in uses `signInWithPassword`. Sign-up uses `signUp`; if
  email confirmation is on, the user has to click the link in
  their inbox before `signIn` will succeed.

### `client/src/components/AuthScreen.tsx`
- Tabbed **Sign in** / **Create account** UI. Plain email + password.
- Shows the Supabase error verbatim if the call fails (e.g.
  *Email not confirmed*, *Invalid login credentials*).
- After successful sign-up, surfaces a "check your email" hint when
  email confirmation is required.

### `client/src/hooks/useWebRTC.ts`
The single hook that owns all WebRTC state. Read it top-to-bottom:
1. `startLocalMedia` calls `navigator.mediaDevices.getUserMedia`.
2. `createPeer` builds `RTCPeerConnection` with public Google STUN
   servers and attaches our local tracks.
3. `pc.ontrack` surfaces the remote stream.
4. `pc.onicecandidate` ships each new candidate to the other peer
   via the channel.
5. `attachSignaling` wires all four broadcast handlers (`offer`,
   `answer`, `ice-candidate`, `chat-message`) plus the presence
   `sync` and `leave` events.
6. `joinRoom` ties it all together:
   - Get the local stream.
   - Build the peer connection.
   - Open a channel and attach handlers.
   - `await ch.subscribe(...)` and call `ch.track({ id: SELF_ID })`
     to announce ourselves via presence.
7. `hangUp` unsubscribes the channel, stops tracks, closes the
   peer connection, and resets state. The unsubscribe fires a
   `presence:leave` event on the other side, which clears the
   remote tile and adds a `(peer left)` system line in the chat.
8. `toggleMic` / `toggleCam` flip `track.enabled` — instant on/off
   without renegotiating.

### Caller/callee rule on Realtime
- Both clients `track({ id })` themselves in presence.
- Realtime's `presence: sync` event fires whenever the set changes.
- Whoever sees a stranger in `presenceState()` is the caller
  (creates the offer). If you joined first, you'll see the second
  joiner when they arrive and call them. If you joined second, the
  first joiner sees you and calls you.
- This is symmetric and glare-free, just like the old Socket.IO
  rule — but we get it for free from Realtime's presence tracking.

### `client/src/components/Lobby.tsx`
The pre-call screen. Two entry points:
- **Join Room** — user types an existing id; submits a form.
- **Create Room** — generates a random 6-char id via
  `Math.random().toString(36).slice(2, 8)`, immediately joins it,
  and shows the id in the call header.
- Surfaces an amber warning if the Supabase env vars are missing or
  still placeholders.

### `client/src/components/VideoTile.tsx`
A reusable `<video>` wrapper. Takes a `MediaStream | null`,
attaches it via `srcObject` in an effect, and shows a placeholder
when there's no stream. Mirroring is a `transform: scaleX(-1)` flag
— natural for self-view, not for remote.

### `client/src/components/ControlBar.tsx`
Three buttons: Mute, Camera off, Hang up. Wired to the controls
returned by `useWebRTC`.

### `client/src/components/ChatPanel.tsx`
A side panel that slides in from the right. Receives the chat
list and an `onSend` callback. The parent (`App`) toggles it via
a `💬 Chat` tab pinned to the right edge of the screen. Messages
auto-scroll into view as they arrive.

### `client/src/App.tsx`
Switches between two screens based on `status`:
- `idle` / `error` → `<Lobby />` (Join / Create buttons)
- `joining` / `in-call` → room-id header, two `<VideoTile />`s,
  `<ControlBar />`, a chat tab on the right edge, and the
  slide-in `<ChatPanel />` when that tab is opened.

---

## 5. How WebRTC signaling works in this project

WebRTC's killer feature is that, once connected, **audio and video
flow directly between the two browsers** — Supabase is not in the
media path. But the two browsers cannot find each other on their
own; they need a third party to introduce them. That third party is
**Supabase Realtime** — it carries the small JSON control messages
that let the browsers agree on how to connect.

In this project the dance looks like this (Alice is already in the
room, Bob is the new joiner):

```
┌──────────┐              ┌────────────────────┐              ┌──────────┐
│  Alice   │              │  Supabase Realtime │              │   Bob    │
│ (callee) │              │  (signaling only)  │              │ (caller) │
└────┬─────┘              └─────────┬──────────┘              └────┬─────┘
     │  presence: track(alice)      │                             │
     │ ────────────────────────────>│                             │
     │                              │   presence: track(bob)      │
     │                              │ <───────────────────────────│
     │  presence: sync (sees bob)   │                             │
     │ <────────────────────────────│                             │
     │  broadcast: offer            │                             │
     │ <────────────────────────────│                             │
     │  broadcast: answer           │                             │
     │ ────────────────────────────>│                             │
     │  broadcast: ice              │                             │
     │ <────────────────────────────│  broadcast: ice             │
     │  broadcast: ice              │ ───────────────────────────>│
     │  ... more candidates ...     │   ... more candidates ...   │
     │                              │                             │
     │  ◀═════ direct P2P media (audio + video) ══════════════▶  │
     └──────────────────────────────┴─────────────────────────────┘
```

The concrete browser API calls that produce the above:

1. **Get local media** — `navigator.mediaDevices.getUserMedia({video, audio})`.
2. **Open a Realtime channel** — `supabase.channel('room:' + id)`.
3. **Subscribe + announce in presence** — `ch.subscribe(...); ch.track({ id })`.
4. **Create the peer connection** — `new RTCPeerConnection({ iceServers })`.
5. **Add local tracks** — `pc.addTrack(track, stream)`.
6. **Caller creates an offer** — `pc.createOffer()` then
   `pc.setLocalDescription(offer)`. Broadcast the SDP via
   `ch.send({ type: 'broadcast', event: 'offer', payload: { sdp } })`.
7. **Callee sets remote description and answers** —
   `pc.setRemoteDescription(offer)`, then `pc.createAnswer()`,
   `pc.setLocalDescription(answer)`, broadcast the SDP back.
8. **ICE candidates** — as the browser discovers network paths, the
   `onicecandidate` callback fires. Each candidate is broadcast to
   the other peer, who calls `pc.addIceCandidate(...)`. Once they
   find a path that works, the connection state becomes `connected`.
9. **Remote media arrives** — `pc.ontrack` fires with the remote
   `MediaStream`. We set it as `video.srcObject` and it just plays.

### Why STUN servers?
Most browsers sit behind NAT. Without help, each side only knows
its private IP, which the other side can't reach. STUN servers (we
use Google's free ones) let each side learn its public IP/port.
The browsers then try those public addresses during ICE, and
(usually) find a path. For a real product behind strict firewalls
you'd add TURN servers, but for a localhost MVP STUN is enough.

### What about TURN on Supabase?
Supabase does **not** bundle TURN. If you need it (corporate
networks, mobile carriers), add Twilio Network Traversal, Cloudflare
Calls, or Metered, and extend `ICE_SERVERS` in `useWebRTC.ts`.

---

## 6. Chat history architecture

Chat used to be a `broadcast` event on the signaling channel. It
now lives in Postgres:

```
React ChatPanel  ──INSERT──>  public.messages
                                     │
                                     │  RLS: user_id must match auth.uid()
                                     │  AND caller must be a room member
                                     ▼
                              Supabase Realtime
                          (postgres_changes on INSERT)
                                     │
                                     ▼
React ChatPanel  ◀──postgres_changes──  postgres_changes subscription
                  (filtered by room_id)
```

Concretely:

- **Persistence**: every chat message is a row in `public.messages`
  with `room_id, user_id, text, created_at`. RLS is the gate.
- **Author identity**: we never trust the client to claim a `user_id`.
  The insert goes through with `user_id = user.id` from the
  `useAuth()` session, and the policy requires `user_id = auth.uid()`.
- **Live delivery**: instead of a broadcast event, we subscribe to
  `postgres_changes` with a per-room filter:
  ```ts
  supabase
    .channel(`messages:${room}`)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages',
          filter: `room_id=eq.${room}` },
        (payload) => appendMessage(payload.new))
    .subscribe();
  ```
  Both peers see each other's messages; if you open a third tab
  signed in as the same user, it sees messages too. No broadcast
  layer needed.
- **History load**: on join, the hook does
  ```ts
  supabase.from('messages')
    .select('id, user_id, text, created_at')
    .eq('room_id', room)
    .order('created_at', { ascending: false })
    .limit(50);
  ```
  and reverses the result for the panel. RLS limits which rooms you
  can read to the ones you are a member of.
- **Membership gate**: the SELECT and INSERT policies on `messages`
  call `public.is_room_member(room_id)`, which checks the
  `room_members` table. You must have a row there to read or write.

### Why postgres_changes instead of broadcast?

- **One source of truth**: the row in Postgres. Refresh the page,
  rejoin later, the history is still there.
- **Authoritative sender id**: the row's `user_id` is set by RLS,
  not by a self-claim in a broadcast payload.
- **No dedupe dance**: we don't optimistically add our own message
  and then have to ignore the echo from the server. The INSERT
  round-trip is fast enough on Supabase.

### Why a separate channel from the signaling one?

`channel.on('broadcast', ...)` and `channel.on('postgres_changes', ...)`
are different event families. We keep the signaling channel
(`room:<id>`, broadcast + presence) and the messages channel
(`messages:<id>`, postgres_changes) separate so they have
independent lifecycles and you can later attach the chat
subscription to a wider room subscription without touching the
signaling flow.

---

## 7. Per-room membership

The third migration adds a `public.room_members` table and rewrites
the RLS on `rooms` and `messages` so that **only members of a room
can read its data or write to it**. The room id alone is no longer
enough — you have to be in `room_members` first.

### The invariant

> Before a client subscribes to the messages or signaling channel,
> a row in `public.room_members` must exist for
> `(room_id, auth.uid())`.

The client enforces this in `useWebRTC.joinRoom` by calling
`ensureMembership(room, user.id)` *before* any channel subscribe.
`ensureMembership` runs three steps:

1. `SELECT id FROM rooms WHERE id = $room` — does the room exist?
2. `SELECT role FROM room_members WHERE room_id = $room AND user_id = $me` — am I already a member?
3. If the room doesn't exist, `INSERT INTO rooms (id, created_by)`
   (as host). If I'm not a member, `INSERT INTO room_members
   (room_id, user_id, role)` where `role` is `host` (we just
   created the room) or `guest` (the room already existed).

The `ignoreDuplicates: true` upsert makes this idempotent — joining
the same room twice is a no-op.

### Why an `is_room_member()` SQL helper?

The `messages` and `rooms` policies both need to ask "is the caller
a member of this room?". Writing that `EXISTS` subquery in every
policy would be repetitive and easy to drift out of sync. The
`public.is_room_member(text)` function is `SECURITY DEFINER`, so the
RLS on `room_members` doesn't recurse when called from a policy on a
different table.

### Create vs Join from the user's point of view

The Lobby has two buttons that look different but call the same
`joinRoom` function:

- **Create Room** generates a fresh id (e.g. `k3p9qx`) and immediately
  joins it. Because the room doesn't exist yet, `ensureMembership`
  inserts it and adds the caller as `host`.
- **Join Room** uses an id the user typed. The room may or may not
  exist. If it exists, the caller is added as `guest`. If it
  doesn't (typo or a long-dead room), the caller still becomes
  `host` of a fresh room under that id — a future caller with the
  same id will see them as the host. For the MVP that's "good
  enough"; tighten it by adding a `room_invites` table that gates
  `INSERT INTO room_members` on a valid invite token.

### What the Realtime policy does and doesn't do

The Realtime authorization policy from `0001` says: only
`authenticated` users can subscribe to any channel. It does **not**
know about `room_members`. That's by design — a member of a room
who somehow learned *another* room's id could still subscribe to
that room's `room:<other>` channel and just sit on it.

For a real product, the next tightening pass is a per-channel
Realtime authorization function (`realtime.check_channel` or
similar) that reads the channel name, looks up membership, and
returns true only for rooms the JWT's `sub` belongs to. That's out
of scope for the MVP but a clean follow-up.

---

## 8. Invite-gated joins

The fourth migration replaces the open "any signed-in user can
self-insert into `room_members`" policy from `0003` with a true
invite gate. There is now exactly **one** way for a non-host to
become a member of a room: present a valid, unused, unexpired
invite token.

### How the host creates an invite

The host (the user who created the room, role = `host`) calls the
in-call **📨 Invite** button. The client inserts a row into
`public.room_invites`:

```sql
insert into public.room_invites (room_id, created_by)
values ($room, $host) returning token;
```

The default expiry is 24 hours. The column's `default` does the
work, but you can override it by passing an explicit `expires_at`.
The token is a 32-character URL-safe base64 of 24 random bytes
(`encode(gen_random_bytes(24), 'base64')`).

RLS on `room_invites` lets the host SELECT and INSERT; everyone
else is blocked.

### How a guest redeems an invite

The guest types the token into the Lobby's **I have an invite
code** field and clicks **Join Room**. The hook calls:

```ts
supabase.rpc('redeem_invite', { p_room_id: room, p_token: token });
```

`redeem_invite` is a `SECURITY DEFINER` PL/pgSQL function that
runs in a single transaction:

1. `select ... for update` on the invite row → locks the row so
   two concurrent redemptions can't both succeed.
2. Verifies the row exists (`invalid invite` if not).
3. Verifies `expires_at > now()` (`invite expired` otherwise).
4. Verifies `used_by is null` (`invite already used` otherwise).
5. `update room_invites set used_by = auth.uid(), used_at = now()`
   **before** the membership insert — if the insert fails for any
   reason, the token is consumed and a retry won't succeed, which
   is the safe failure mode.
6. `insert into room_members (..., role = 'guest')`.

If any step fails, the whole transaction rolls back.

### Why RPCs instead of RLS subqueries?

The 0003 `INSERT` policy on `room_members` had a structural
problem: a policy can read from other tables in `with check`, but
the read happens **before** the row is committed, so a client
could craft a token-like value that passes the `EXISTS` check
without actually matching a real invite. The RPCs sidestep that
entirely by:

- Running as the function owner, which bypasses RLS on
  `room_members`. That's the *only* row in the table that the RPC
  inserts into, and the RPC itself is the gate.
- Doing all the validation in server-side PL/pgSQL where the client
  cannot influence the checks.
- Locking the invite row with `for update` so concurrent
  redemptions are serialized.

The old open `INSERT` policy is dropped in 0004 — direct inserts
to `room_members` are now denied to all roles, including
`authenticated`. The only path is the RPC.

### Host self-join

Hosts don't need an invite. When the user clicks **Create Room**,
the client calls `create_room_with_host(room_id)` instead. That
RPC atomically inserts the `rooms` row (if missing) and the
`room_members` row with `role = 'host'`. If the room already
exists from a previous session, the host insert is a no-op (it
just makes them a member again, which is the right behavior).

### Token lifetime and revocation

- **Lifetime**: 24 hours by default. Add an `expires_at` parameter
  to `createInvite` if you want a custom window per invite.
- **One-time use**: enforced by setting `used_by` and `used_at` on
  the invite row. A second `redeem_invite` call with the same
  token returns `invite already used`.
- **Revocation**: there is no UPDATE policy on `room_invites`, so
  the client cannot revoke an invite. Drop the entire room row
  (`delete from rooms where id = $1`) — the `on delete cascade`
  on `room_invites.room_id` cleans up the outstanding invites
  and `room_members` rows in one shot.

### Negative test: try to join without an invite

After 0004 is applied, open a fresh incognito window, sign up a
new user, and try to call:

```js
await supabase.rpc('redeem_invite', { p_room_id: 'demo', p_token: 'fake' });
```

You should get back `invalid invite` as a Postgres exception
(`P0002`). Direct INSERTs to `room_members` should fail with the
RLS denial ("new row violates row-level security policy"). That
confirms the gate is working.

---

## 9. Per-channel Realtime authorization

The fifth migration closes the last authorization gap. The 0001
policy was:

```sql
create policy "authenticated can use realtime"
  on realtime.messages
  for all
  to authenticated
  using (true) with check (true);
```

That is correct (only signed-in users can use Realtime at all) but
it's also **coarse**: any authenticated user could subscribe to any
channel name, including `room:<somebody-elses-room>`. The data
inside the channel was still private (because of the membership
checks on `messages` and `room_members`), but the *subscription*
itself wasn't — a malicious client could sit on the channel and
observe presence/broadcast metadata (who's connected, when).

### How Realtime policies work

Realtime authorization is implemented as RLS on the
`realtime.messages` table. Each message Realtime routes has:

- A **topic** — the channel name (e.g. `room:abc123`).
- An **extension** — `'broadcast' | 'presence' | 'postgres_changes'`.
- A **payload** — the message body.

Inside a policy, you can read the topic with `realtime.topic()`
and the JWT subject with `auth.uid()`. The two RLS clauses you
have to define are:

- `for select to authenticated using (...)` — can this connection
  receive messages on this channel?
- `for insert to authenticated with check (...)` — can this
  connection send messages on this channel?

### The new policies

```sql
create policy "members can receive broadcast/presence in their rooms"
  on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and split_part(realtime.topic(), ':', 1) in ('room', 'messages')
    and public.is_room_member(split_part(realtime.topic(), ':', 2))
  );

create policy "members can broadcast in their rooms"
  on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and split_part(realtime.topic(), ':', 1) in ('room', 'messages')
    and public.is_room_member(split_part(realtime.topic(), ':', 2))
  );
```

The membership check is the same `is_room_member(text)` helper
from `0003`. We extract the room id from the topic by splitting on
`:` and taking the second part — the policy only allows topics
with the `room:` or `messages:` namespace prefix that the app
actually uses. Any future prefix (e.g. a hypothetical
`audit-log:<id>`) defaults to "deny" until you write a policy for
it, which is the right default.

### What about `postgres_changes`?

The `postgres_changes` extension — what the chat panel uses to see
new rows in `public.messages` — is **not** gated by these Realtime
policies. Realtime's `postgres_changes` path is authorized at a
different layer (publication replication grants), not by RLS on
`realtime.messages`. The defense-in-depth still works though: a
non-member can subscribe to `messages:<id>` but the subscription
will receive **no rows**, because the `SELECT` RLS on
`public.messages` still requires `is_room_member(room_id)`. So
the data path is private even when the subscription itself isn't.

### The client side: `setAuth` and the `accessToken` callback

The Supabase JS client attaches a JWT to the Realtime WebSocket
so the server-side policy can read `auth.uid()`. The current API:

```ts
// Synchronous string form. The token is read once at call time.
supabase.realtime.setAuth(accessToken);

// Async callback form, configured on the client at construction.
// Realtime calls this on every (re)connect and refresh.
createClient(url, key, {
  realtime: {
    accessToken: async () => (await supabase.auth.getSession())
      .data.session?.access_token ?? null,
  },
});
```

We use the **callback form** in `lib/supabase.ts` because the
Supabase Auth layer transparently refreshes the session, and
Realtime will re-invoke the callback whenever it needs a fresh
token. That means JWT rotations just work — no extra wiring in
the hook.

### Negative test

After `0005` is applied, sign in as a user who is **not** a member
of `room:demo` and try to subscribe from the devtools console:

```js
const ch = supabase.channel('room:demo')
  .on('broadcast', { event: 'offer' }, (p) => console.log(p))
  .subscribe((status, err) => console.log(status, err));
```

You should see `CHANNEL_ERROR` (or a similar denied status) and
the `broadcast` handler never fires. As a member of `room:demo`,
the same code succeeds and you see `SUBSCRIBED`.

The same test against a `messages:demo` channel: a non-member
gets `SUBSCRIBED` (the subscription is allowed) but no
`postgres_changes` events arrive, because the underlying
`public.messages` RLS still filters the rows.

### Layered defense

With all five migrations applied, the access control layers are:

1. **Auth** — Supabase Auth rejects anonymous channel subscriptions
   (`0001`).
2. **Membership** — RLS on `room_members` / `messages` / `rooms`
   requires a row in `room_members` (`0003`).
3. **Invites** — The only way to add to `room_members` is via
   `redeem_invite` with a valid token, or `create_room_with_host`
   as the room creator (`0004`).
4. **Realtime subscription** — Even with a valid JWT, a
   subscription to `room:<id>` requires membership (`0005`).
5. **Data** — Even with a valid subscription, the rows in
   `public.messages` are filtered by the table's RLS, which still
   requires membership.

A user has to be authenticated, in the right room, and subscribed
to the right channel to learn anything at all.

---

## 10. Custom invite expiry

The sixth migration gives the host control over how long an invite
token stays valid. Before this, the `0004` migration let the host
INSERT directly into `public.room_invites` and relied on the column
default of 24 hours — no way to mint a 15-minute or 7-day invite
from the client. The new `create_invite` RPC is the only path to
add a row, and it accepts a duration.

### The RPC

```sql
create or replace function public.create_invite(
  p_room_id text,
  p_expires_in_seconds int default 86400   -- 24h, matches the column default
) returns text
language plpgsql security definer
as $$
declare
  v_seconds int;
  v_expires timestamptz;
  v_token   text;
begin
  if not public.is_room_host(p_room_id) then
    raise exception 'only the room host can create invites';
  end if;
  v_seconds := greatest(60, least(coalesce(p_expires_in_seconds, 86400), 604800));
  v_expires := now() + make_interval(secs => v_seconds);
  insert into public.room_invites (room_id, created_by, expires_at)
  values (p_room_id, auth.uid(), v_expires)
  returning token into v_token;
  return v_token;
end;
$$;
```

Three things worth calling out:

- **Duration, not timestamp.** The client passes a positive integer
  of seconds. The server computes `now() + make_interval(...)`. This
  is much harder to get wrong on the client side (no timezone math,
  no clock-skew bugs).
- **Server-side clamping.** The `greatest(60, least(..., 604800))`
  pattern means: minimum 1 minute (anything shorter is almost
  certainly a UI bug like `setSeconds(0)`), maximum 7 days (longer-
  lived invites can be a separate "permanent link" feature with
  its own audit story). The client doesn't need to know these
  limits — the server returns a clamped invite either way.
- **RPC returns the token.** One round trip instead of `INSERT`
  then `SELECT` (which would also work via the host SELECT policy,
  but costs an extra message).

### The open INSERT path is closed

`0004` left a `hosts can create invites` INSERT policy on
`public.room_invites` so the host could mint a token with one
`insert().select()` call from the client. That policy is **dropped**
in `0006` and **not replaced**. The only way to add an invite row
is the RPC, which runs as the function owner (bypassing RLS) and
performs all the validation. A malicious host can no longer
bypass the duration clamp or the host-role check by crafting a raw
INSERT.

### Client wiring

`useWebRTC.createInvite(expiresInSeconds?: number)` now defaults
to 24 hours and otherwise passes the value through to the RPC.
The in-call header's **📨 Invite** button opens a small popover
with three preset chips (15 min / 1 hour / 24 hours) and a
"custom (minutes)" number input. The number input converts
minutes to seconds; the RPC handles the rest.

### Negative test

After `0006` is applied, from the devtools console as a signed-in
host of `room:demo`:

```js
// 1. Valid 15-minute invite:
const t1 = await supabase.rpc('create_invite', {
  p_room_id: 'demo',
  p_expires_in_seconds: 900,
});
console.log(t1);  // -> { data: '...long base64...', error: null }

// 2. Too short — should clamp to 60 seconds, not fail:
const t2 = await supabase.rpc('create_invite', {
  p_room_id: 'demo',
  p_expires_in_seconds: 5,
});
// -> succeeds; expires_at = now() + 60s
// Verify with:
// select expires_at from room_invites where token = '<t2.data>';

// 3. Too long — should clamp to 604800 seconds (7 days):
const t3 = await supabase.rpc('create_invite', {
  p_room_id: 'demo',
  p_expires_in_seconds: 60 * 60 * 24 * 30,  // 30 days
});
// -> succeeds; expires_at = now() + 7 days

// 4. Direct INSERT as a non-host is now rejected (RLS denies):
await supabase.from('room_invites').insert({
  room_id: 'demo', created_by: '<your-uid>',
});
// -> "new row violates row-level security policy for table 'room_invites'"

// 5. RPC call as a non-host is also rejected:
await supabase.rpc('create_invite', { p_room_id: 'demo', p_expires_in_seconds: 900 });
// -> "only the room host can create invites"
```

---

## 11. Security model

The app has three layers of access control, applied in this order:

1. **Auth** (Supabase Auth). You must be signed in to use the app.
   The Auth screen enforces this client-side; the Realtime
   authorization policy (`0001`) enforces it server-side for
   channel subscriptions.
2. **Membership** (`0003`). A row in `public.room_members` for
   `(room_id, auth.uid())` is required to:
   - `SELECT` from `public.messages` filtered by that `room_id`
   - `INSERT` into `public.messages` for that `room_id`
   - `SELECT` from `public.rooms` for that room id
   The client maintains this row in `useWebRTC.joinRoom` via
   `ensureMembership(room, user.id)`. RLS on the writes means a
   user can only insert a row naming themselves as the author.
3. **Realtime channel subscription** (also from `0001`). Any
   authenticated user can subscribe to any channel name. This is
   the weakest link — a member of room A who learns room B's id
   can subscribe to B's `room:<B>` channel and sit on it. The
   next tightening pass is a per-channel Realtime authorization
   function that checks membership; not implemented in the MVP.

The `room_members` write policy currently lets any authenticated
user add themselves to any room (the "I have the room id" check).
For true private rooms, add a `room_invites` table and tighten
the `INSERT` policy on `room_members` to require a valid invite
token.

---

## 12. What was intentionally left out

- **More than 2 peers** — the hook is wired for 1:1. A group call
  needs an SFU (e.g. LiveKit, mediasoup) or a mesh upgrade.
- **TURN servers** — only STUN. Calls will fail on asymmetric NATs.
- **Display names** — chat just says "me" / "peer" via a row-side
  comparison to `auth.uid()`. Join with `auth.users` to show the
  sender's email.
- **Screen share, recording, device picker, bandwidth stats, etc.**

That is exactly the point: a working MVP you can read end-to-end,
hosted on a single platform.
