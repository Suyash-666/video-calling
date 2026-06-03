// components/Lobby.tsx
// Pre-call screen with three entry points:
//   - Join Room:      user types a room id (+ optional invite code) and
//                     joins as guest.
//   - Join via link:  user pastes a full invite URL (or the path part)
//                     and the lobby parses out roomId + token for them.
//   - Create Room:    generates a fresh id, joins as host.
//
// Auto-join: if the page is opened with a `#/join/<room>/<token>` URL
// (e.g. someone clicked an invite link), we pre-fill the inputs AND
// immediately call onJoin. The URL is cleared from the address bar so
// a refresh doesn't re-trigger.
//
// The user must be signed in (parent gates this), so we also render a
// small "signed in as … · Sign out" header.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { MeetingsDashboard } from './MeetingsDashboard';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import {
  clearInviteFromUrl,
  parseInviteLink,
  readInviteFromUrl,
} from '../lib/inviteLink';

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
  const [useInvite, setUseInvite] = useState(false);
  const [inviteToken, setInviteToken] = useState('');

  // Paste-a-link UX. Hidden behind a toggle so the lobby stays compact;
  // hosts who share full URLs put their guests one click + one paste
  // away from being in the room.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  // Auto-join if the page was opened with an invite URL. We trigger this
  // exactly once per mount (the ref guards against StrictMode's double-
  // render in dev) so we don't keep re-firing if `onJoin` happens to be
  // recreated upstream.
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const fromUrl = readInviteFromUrl();
    if (!fromUrl) return;
    autoJoinedRef.current = true;
    // Pre-fill the form so the user has visible feedback about what we
    // parsed, then call onJoin. We also flip useInvite on so the input
    // shows up if they cancel and want to edit.
    setRoomId(fromUrl.roomId);
    setUseInvite(true);
    setInviteToken(fromUrl.token);
    // Strip the hash so a refresh doesn't auto-join again with a
    // potentially already-used token.
    clearInviteFromUrl();
    onJoin(fromUrl.roomId, fromUrl.token);
  }, [onJoin]);

  const submitJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const id = roomId.trim();
    if (!id) return;
    // If the user opted into the invite code, we forward it. If they
    // didn't (and the server now requires one), the RPC will fail with
    // a clear error and we'll surface it through `error` from App.
    onJoin(id, useInvite ? inviteToken.trim() || undefined : undefined);
  };

  const submitLink = (e: React.FormEvent) => {
    e.preventDefault();
    setLinkError(null);
    const parts = parseInviteLink(linkInput);
    if (!parts) {
      setLinkError(
        "That doesn't look like an invite link. Expected something like https://your-app/#/join/<room>/<token>"
      );
      return;
    }
    // Mirror what auto-join does: pre-fill the form so the user can see
    // what we got, then enter the room.
    setRoomId(parts.roomId);
    setUseInvite(true);
    setInviteToken(parts.token);
    setLinkOpen(false);
    setLinkInput('');
    onJoin(parts.roomId, parts.token);
  };

  const createRoom = () => {
    const id = makeRoomId();
    setRoomId(id);
    // Hosts don't need an invite token — they self-insert via the
    // create_room_with_host RPC.
    onJoin(id);
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
        Create a new room, join one with a room id + invite code, or
        paste an invite link.
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

      {/* Join-via-link: a single paste does both fields. Hosts who share
          full URLs let their guests skip the room-id / code juggling. */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
        <button
          type="button"
          onClick={() => {
            setLinkOpen((o) => !o);
            setLinkError(null);
          }}
          className="flex w-full items-center justify-between text-left text-xs font-medium text-slate-300 hover:text-slate-100"
          aria-expanded={linkOpen}
        >
          <span>🔗 Join via invite link</span>
          <span className="text-slate-500">{linkOpen ? '▴' : '▾'}</span>
        </button>

        {linkOpen && (
          <form onSubmit={submitLink} className="mt-2 flex flex-col gap-2">
            <input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Paste the full invite link from the host"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-xs outline-none focus:border-brand-500"
            />
            <button
              type="submit"
              disabled={busy || !linkInput.trim()}
              className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Joining…' : 'Open link'}
            </button>
            {linkError && (
              <p className="text-[11px] text-red-400">{linkError}</p>
            )}
          </form>
        )}
      </div>

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
