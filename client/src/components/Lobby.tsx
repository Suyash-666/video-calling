// components/Lobby.tsx
//
// Pre-call screen. Designed as a single column of typography rather
// than a stack of cards. The page header is a display-sized
// greeting followed by a one-line subhead. The room-id field uses
// the same borderless treatment as the auth form so the two pages
// feel like one product. The meetings dashboard lives below as a
// quiet hairline-divided list — not a card of rows.
//
// Auto-join and link-paste behavior are preserved from the prior
// version, but their UI is now the same text-link-with-underline
// pattern as the rest of the app.

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import { MeetingsDashboard } from './MeetingsDashboard';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import {
  clearInviteFromUrl,
  parseInviteLink,
  readInviteFromUrl,
} from '../lib/inviteLink';
import {
  ArrowRightIcon,
  ChevronDownIcon,
  LinkIcon,
  PlusIcon,
} from './Icons';

interface Props {
  onJoin: (roomId: string, inviteToken?: string) => void;
  busy: boolean;
  error: string | null;
}

// 6-char base36 id, e.g. "k3p9qx". Good enough to feel "room-y"
// while still being easy to type if you want to share verbally.
// We pair it with a server-side check in `joinRoom` to be safe, but
// for an MVP the id's randomness is enough to avoid casual
// collisions.
function makeRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

export function Lobby({ onJoin, busy, error }: Props) {
  const { user, signOut } = useAuth();
  const [roomId, setRoomId] = useState('demo');
  const [useInvite, setUseInvite] = useState(false);
  const [inviteToken, setInviteToken] = useState('');

  // Paste-a-link UX. Hidden behind a toggle so the lobby stays
  // compact; hosts who share full URLs put their guests one click
  // + one paste away from being in the room.
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  // Auto-join if the page was opened with an invite URL. We
  // trigger this exactly once per mount (the ref guards against
  // StrictMode's double-render in dev) so we don't keep re-firing
  // if `onJoin` happens to be recreated upstream.
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (autoJoinedRef.current) return;
    const fromUrl = readInviteFromUrl();
    if (!fromUrl) return;
    autoJoinedRef.current = true;
    setRoomId(fromUrl.roomId);
    setUseInvite(true);
    setInviteToken(fromUrl.token);
    clearInviteFromUrl();
    onJoin(fromUrl.roomId, fromUrl.token);
  }, [onJoin]);

  const submitJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const id = roomId.trim();
    if (!id) return;
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
    onJoin(id);
  };

  // Surface a friendly hint if the user hasn't configured Supabase yet.
  const url = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
  const key = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';
  const envMissing = !url || !key || url.includes('YOUR_PROJECT_REF');

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-16
                    px-8 py-16 md:px-16 md:py-24">
      {/* ----------------------------------------------------------------
          PAGE HEADER
          ---------------------------------------------------------------- */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-small
                        tracking-[0.18em] text-ink-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full
                           bg-accent" />
          ZOOM&nbsp;MINI
        </div>
        <div className="flex items-center gap-6 text-small">
          <span className="text-ink-500">
            {user?.email ?? 'unknown'}
          </span>
          <button
            onClick={() => signOut()}
            className="action-secondary"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ----------------------------------------------------------------
          GREETING + ACTIONS
          ---------------------------------------------------------------- */}
      <section className="grid grid-cols-1 gap-16 md:grid-cols-12">
        <div className="md:col-span-7">
          <p className="micro-label mb-6">LOBBY</p>
          <h1 className="display-md text-ink-50">
            Where to, then.
          </h1>
          <p className="mt-6 max-w-md text-body leading-relaxed
                       text-ink-400">
            Drop in a room id, paste a link, or start a fresh one.
            Two users in the same room is a call.
          </p>
        </div>

        <form
          onSubmit={submitJoin}
          className="md:col-span-5 flex flex-col gap-8"
        >
          <label className="block">
            <span className="micro-label">ROOM ID</span>
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="room id, e.g. demo"
              className="input-bare mt-2 font-mono"
              autoFocus
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </label>

          {/* Invite code sub-field, gated by a quiet toggle. The
              toggle is a checkbox + label pair, no card, no
              segmented control. The input appears below when
              checked. */}
          <div>
            <label className="flex cursor-pointer items-center gap-3
                              text-small text-ink-400 outline-none
                              transition-colors duration-180 ease-out
                              hover:text-ink-200">
              <input
                type="checkbox"
                checked={useInvite}
                onChange={(e) => setUseInvite(e.target.checked)}
                className="h-3 w-3 cursor-pointer
                           accent-accent"
              />
              I have an invite code
            </label>

            {useInvite && (
              <input
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                placeholder="invite code"
                className="input-bare-sm mt-4"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            )}
          </div>

          {/* Primary actions. Two text links side by side, the
              first (Join) is the primary, the second (Create) is
              secondary. Both use the action-primary/action-
              secondary utilities; the visual difference is the
              underline (primary) vs. no underline (secondary). */}
          <div className="mt-2 flex items-center gap-8">
            <button
              type="submit"
              disabled={busy}
              aria-disabled={busy}
              className="action-primary"
            >
              {busy ? 'Joining…' : 'Join room'}
              <ArrowRightIcon size={14} className="opacity-60" />
            </button>
            <button
              type="button"
              onClick={createRoom}
              disabled={busy}
              className="action-secondary inline-flex items-center gap-2"
            >
              <PlusIcon size={14} />
              Create room
            </button>
          </div>

          {error && (
            <p className="text-small text-state-error">{error}</p>
          )}
        </form>
      </section>

      {/* ----------------------------------------------------------------
          INVITE-LINK EXPAND
          ---------------------------------------------------------------- */}
      <section className="border-t hairline-t pt-6">
        <button
          type="button"
          onClick={() => {
            setLinkOpen((o) => !o);
            setLinkError(null);
          }}
          className="flex w-full items-center justify-between text-left
                     text-small text-ink-400 outline-none
                     transition-colors duration-180 ease-out
                     hover:text-ink-200"
          aria-expanded={linkOpen}
        >
          <span className="flex items-center gap-2">
            <LinkIcon size={14} />
            Join via invite link
          </span>
          <ChevronDownIcon
            size={14}
            className={`transition-transform duration-180 ease-out
                        ${linkOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {linkOpen && (
          <form onSubmit={submitLink} className="mt-6 flex flex-col gap-4">
            <input
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Paste the full invite link"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="input-bare-sm"
            />
            <div className="flex items-center gap-6">
              <button
                type="submit"
                disabled={busy || !linkInput.trim()}
                aria-disabled={busy || !linkInput.trim()}
                className="action-primary"
              >
                {busy ? 'Joining…' : 'Open link'}
                <ArrowRightIcon size={14} className="opacity-60" />
              </button>
              {linkError && (
                <p className="text-small text-state-error">{linkError}</p>
              )}
            </div>
          </form>
        )}
      </section>

      {/* ----------------------------------------------------------------
          OPTIONAL BANNERS
          ---------------------------------------------------------------- */}
      {envMissing && (
        <section className="border-t hairline-t pt-6">
          <p className="micro-label mb-3 text-state-error">
            CONFIGURATION
          </p>
          <p className="max-w-2xl text-small leading-relaxed
                       text-ink-400">
            Supabase env vars are missing. Copy{' '}
            <span className="font-mono text-ink-200">
              client/.env.example
            </span>{' '}
            to{' '}
            <span className="font-mono text-ink-200">
              client/.env.local
            </span>{' '}
            and fill in{' '}
            <span className="font-mono text-ink-200">
              VITE_SUPABASE_URL
            </span>{' '}
            and{' '}
            <span className="font-mono text-ink-200">
              VITE_SUPABASE_ANON_KEY
            </span>
            , then restart{' '}
            <span className="font-mono text-ink-200">npm run dev</span>.
          </p>
        </section>
      )}

      {/* ----------------------------------------------------------------
          SCHEDULED MEETINGS — hairline-divided list
          ---------------------------------------------------------------- */}
      <section className="border-t hairline-t pt-6">
        <MeetingsDashboard onJoin={onJoin} />
      </section>

      {/* ----------------------------------------------------------------
          ANALYTICS — host-only data; renders an empty state for
          guests. RLS hides other hosts' rows.
          ---------------------------------------------------------------- */}
      <section className="border-t hairline-t pt-6">
        <AnalyticsDashboard />
      </section>
    </div>
  );
}

// Re-exported for use elsewhere if you want to pre-fill the input.
export { makeRoomId };
