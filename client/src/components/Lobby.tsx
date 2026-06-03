// components/Lobby.tsx
// Pre-call screen with two entry points:
//   - Join Room:   user types an existing room id AND an invite token
//                  (issued by the host) and joins as guest.
//   - Create Room: generates a fresh id, joins as host. After the call
//                  connects, the host can mint an invite from the
//                  in-call header to share with a guest.
//
// The user must be signed in (parent gates this), so we also render a
// small "signed in as … · Sign out" header.

import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { MeetingsDashboard } from './MeetingsDashboard';
import { AnalyticsDashboard } from './AnalyticsDashboard';

interface Props {
  onJoin: (roomId: string, inviteToken?: string) => void;
  busy: boolean;
  error: string | null;
}

// 6-char base36 id, e.g. "k3p9qx". Good enough to feel "room-y" while
// still being easy to type if you want to share verbally. We pair it
// with a server-side check in `joinRoom` to be safe, but for an MVP
// the id's randomness is enough to avoid casual collisions.
function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

export function Lobby({ onJoin, busy, error }: Props) {
  const { user, signOut } = useAuth();
  const [roomId, setRoomId] = useState('demo');
  const [copied, setCopied] = useState(false);
  const [useInvite, setUseInvite] = useState(false);
  const [inviteToken, setInviteToken] = useState('');

  const submitJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const id = roomId.trim();
    if (!id) return;
    // If the user opted into the invite code, we forward it. If they
    // didn't (and the server now requires one), the RPC will fail with
    // a clear error and we'll surface it through `error` from App.
    onJoin(id, useInvite ? inviteToken.trim() || undefined : undefined);
  };

  const createRoom = () => {
    const id = makeRoomId();
    setRoomId(id);
    setCopied(false);
    // Hosts don't need an invite token — they self-insert via the
    // create_room_with_host RPC.
    onJoin(id);
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; non-fatal.
    }
  };

  // Surface a friendly hint if the user hasn't configured Supabase yet.
  const url = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
  const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';
  const envMissing = !url || !key || url.includes('YOUR_PROJECT_REF');

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <header className="flex items-center justify-between text-xs text-slate-400">
        <span>
          Signed in as{' '}
          <span className="font-medium text-slate-200">
            {user?.email ?? 'unknown'}
          </span>
        </span>
        <button
          onClick={() => signOut()}
          className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700"
        >
          Sign out
        </button>
      </header>

      <h1 className="text-center text-2xl font-semibold">Zoom Mini</h1>
      <p className="text-center text-sm text-slate-400">
        Create a new room as host, or join an existing one with an invite code.
      </p>

      {envMissing && (
        <div className="rounded-lg border border-amber-700/40 bg-amber-900/20 p-3 text-xs text-amber-200">
          Supabase env vars are missing. Copy <code>client/.env.example</code> to{' '}
          <code>client/.env.local</code> and fill in <code>VITE_SUPABASE_URL</code>{' '}
          and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>.
        </div>
      )}

      <form onSubmit={submitJoin} className="flex flex-col gap-3">
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="room id, e.g. demo"
          className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm outline-none focus:border-brand-500"
          autoFocus
        />

        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={useInvite}
            onChange={(e) => setUseInvite(e.target.checked)}
            className="h-3 w-3"
          />
          I have an invite code
        </label>

        {useInvite && (
          <input
            value={inviteToken}
            onChange={(e) => setInviteToken(e.target.value)}
            placeholder="invite code (from the host)"
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm outline-none focus:border-brand-500"
            autoComplete="off"
            spellCheck={false}
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? 'Joining…' : 'Join Room'}
          </button>
          <button
            type="button"
            onClick={createRoom}
            disabled={busy}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-semibold hover:bg-slate-700 disabled:opacity-50"
          >
            Create Room
          </button>
        </div>
      </form>

      {error && <p className="text-center text-sm text-red-400">{error}</p>}

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-center text-xs text-slate-500">
        Tip: sign in with two different accounts in two browser tabs.
        In Tab 1 click <strong>Create Room</strong>, then use the
        <strong> Invite</strong> button to copy a code. In Tab 2 check
        <em> I have an invite code</em>, paste it, and click{' '}
        <strong>Join Room</strong>.
      </div>

      {/* Scheduled-meetings dashboard. Lives in the lobby so the user
          can plan / kick off meetings without entering a call first.
          Joining from here goes through the same onJoin pipeline as the
          buttons above, so all the auth / waiting-room logic applies. */}
      <MeetingsDashboard onJoin={onJoin} />

      {/* Meeting analytics — host-only data, but the panel renders an
          empty-state for guests too. RLS hides other hosts' rows. */}
      <AnalyticsDashboard />
    </div>
  );
}

// Re-exported for use elsewhere if you want to pre-fill the input.
export { makeRoomId };

// Exposed so the in-call header can reuse the same "Copy" UX if you wire it.
export function CopyButton({ value }: { value: string }) {
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(value)}
      className="rounded bg-slate-700 px-2 py-0.5 text-xs hover:bg-slate-600"
    >
      Copy
    </button>
  );
}
