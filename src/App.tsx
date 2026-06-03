// App.tsx
// Top-level layout. Three screens, gated by auth state:
//   - auth:        not signed in -> <AuthScreen />
//   - lobby:       signed in, not in a call -> <Lobby />
//   - in-call:     signed in, joined a room -> video tiles + controls
//
// The chat tab + slide-in <ChatPanel /> are only available in-call.

import { useEffect, useRef, useState } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useAuth } from './lib/auth';
import { AuthScreen } from './components/AuthScreen';
import { Lobby } from './components/Lobby';
import { VideoTile } from './components/VideoTile';
import { ControlBar } from './components/ControlBar';
import { ChatPanel } from './components/ChatPanel';

export default function App() {
  const { user, loading } = useAuth();
  const {
    status,
    error,
    roomId,
    role,
    localStream,
    remote,
    controls,
    chat,
    chatLoading,
    sendChat,
    joinRoom,
    createInvite,
    hangUp,
  } = useWebRTC();

  const [chatOpen, setChatOpen] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  // Custom-minutes input, in minutes. Empty string means "use a preset".
  const [inviteMinutes, setInviteMinutes] = useState<string>('');
  // Ref to the wrapper that contains BOTH the trigger button and the
  // popover. We use this for the outside-click check below.
  const inviteWrapperRef = useRef<HTMLDivElement | null>(null);

  // Preset windows in seconds. The server clamps to 1 minute .. 7 days,
  // so any of these are safe to send verbatim.
  const INVITE_PRESETS: { label: string; seconds: number }[] = [
    { label: '15 min', seconds: 15 * 60 },
    { label: '1 hour', seconds: 60 * 60 },
    { label: '24 hours', seconds: 24 * 60 * 60 },
  ];

  // Issue an invite and copy the token to the clipboard. Falls back to
  // displaying the token if the clipboard write is blocked.
  const issueInvite = async (seconds: number) => {
    const token = await createInvite(seconds);
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setInviteFeedback('Invite copied to clipboard');
    } catch {
      setInviteFeedback(token);
    }
    setTimeout(() => setInviteFeedback(null), 6000);
    setInvitePanelOpen(false);
    setInviteMinutes('');
  };

  // Close the invite panel on outside click. We use a ref + target
  // check instead of a global `window` listener because the previous
  // implementation re-registered the listener in the same tick as the
  // click that opened the panel, which (under React 18's event
  // ordering) caused the panel to immediately re-close. The target
  // check is also more correct: it ignores clicks on the trigger
  // button itself, not just on the popover.
  useEffect(() => {
    if (!invitePanelOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && inviteWrapperRef.current?.contains(target)) return;
      setInvitePanelOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [invitePanelOpen]);

  const inCall = status === 'joining' || status === 'in-call';

  // While the initial session is being restored, show a tiny placeholder
  // so we don't flash the auth screen for signed-in users.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-slate-900 p-4 sm:p-6">
      {!user ? (
        <div className="flex min-h-[80vh] items-center">
          <AuthScreen />
        </div>
      ) : !inCall ? (
        <div className="flex min-h-[80vh] items-center">
          <Lobby onJoin={joinRoom} busy={false} error={error} />
        </div>
      ) : (
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <span>
                Room: <span className="font-mono text-slate-200">{roomId}</span>
              </span>
              {role && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    role === 'host'
                      ? 'bg-emerald-900/50 text-emerald-300'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                  title={
                    role === 'host'
                      ? 'You are the room host — only the host can issue invites.'
                      : 'You joined this room with an invite.'
                  }
                >
                  {role}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {role === 'host' && (
                <div className="relative" ref={inviteWrapperRef}>
                  <button
                    onClick={() => setInvitePanelOpen((o) => !o)}
                    className="rounded bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  >
                    📨 Invite
                  </button>
                  {invitePanelOpen && (
                    <div
                      className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                        Expires in
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {INVITE_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            onClick={() => issueInvite(p.seconds)}
                            className="rounded bg-slate-800 px-2 py-1.5 text-xs font-medium hover:bg-slate-700"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={10080}
                          value={inviteMinutes}
                          onChange={(e) => setInviteMinutes(e.target.value)}
                          placeholder="custom (minutes)"
                          className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
                        />
                        <button
                          onClick={() => {
                            const m = parseInt(inviteMinutes, 10);
                            if (Number.isFinite(m) && m > 0) {
                              issueInvite(m * 60);
                            }
                          }}
                          disabled={!parseInt(inviteMinutes, 10)}
                          className="rounded bg-brand-500 px-2 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
                        >
                          Issue
                        </button>
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500">
                        Server clamps to 1 min .. 7 days.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="text-xs text-slate-500">
                {status === 'joining' ? 'Connecting…' : 'Connected'}
              </div>
            </div>
          </header>

          {inviteFeedback && (
            <p className="rounded-md border border-emerald-800/40 bg-emerald-900/20 p-2 text-center text-xs text-emerald-200">
              {inviteFeedback.startsWith('Invite')
                ? inviteFeedback
                : `Invite token: ${inviteFeedback}`}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <VideoTile
              stream={localStream}
              muted
              mirrored
              label="You"
              placeholder="Starting camera…"
            />
            <VideoTile
              stream={remote.remoteStream}
              muted={false}
              label="Remote"
              placeholder={remote.hasRemote ? '' : 'Waiting for the other person…'}
            />
          </div>

          <ControlBar controls={controls} onHangUp={hangUp} />

          {error && <p className="text-center text-sm text-red-400">{error}</p>}

          <button
            onClick={() => setChatOpen((o) => !o)}
            className="fixed right-0 top-1/2 z-20 -translate-y-1/2 rounded-l-lg bg-slate-800 px-3 py-4 text-xs font-semibold tracking-wider text-slate-200 shadow hover:bg-slate-700"
            aria-label={chatOpen ? 'Close chat' : 'Open chat'}
          >
            {chatOpen ? '×' : '💬 Chat'}
          </button>

          <ChatPanel
            open={chatOpen}
            messages={chat}
            loading={chatLoading}
            onSend={sendChat}
            onClose={() => setChatOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
