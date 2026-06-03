// App.tsx
// Top-level layout. Three screens, gated by auth state:
//   - auth:        not signed in -> <AuthScreen />
//   - lobby:       signed in, not in a call -> <Lobby />
//   - in-call:     signed in, joined a room -> video tiles + controls
//
// The chat tab + slide-in <ChatPanel /> are only available in-call, and
// a participant sidebar slides in from the right when toggled.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useAuth } from './lib/auth';
import { AuthScreen } from './components/AuthScreen';
import { Lobby } from './components/Lobby';
import { VideoTile } from './components/VideoTile';
import { ControlBar } from './components/ControlBar';
import { ChatPanel } from './components/ChatPanel';
import { ParticipantSidebar } from './components/ParticipantSidebar';
import { WaitingScreen, WaitingRoomPanel } from './components/WaitingRoom';
import { MAX_PARTICIPANTS } from './types';
import { buildInviteLink } from './lib/inviteLink';

export default function App() {
  const { user, loading } = useAuth();
  const {
    status,
    error,
    roomId,
    role,
    participants,
    participantCount,
    controls,
    reactions,
    sendReaction,
    toggleHand,
    lowerAllHands,
    recording,
    chat,
    chatLoading,
    sendChat,
    joinRoom,
    createInvite,
    waiting,
    cancelWaiting,
    pendingRequests,
    approveRequest,
    rejectRequest,
    waitingRoomEnabled,
    setWaitingRoomEnabled,
    hangUp,
  } = useWebRTC();

  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  // 'code' = copy the bare token; 'link' = copy a full URL that the
  // guest can paste into the lobby's "Join via invite link" field or
  // open directly to auto-join. Default to link — it's the friendlier
  // share for most cases.
  const [inviteMode, setInviteMode] = useState<'code' | 'link'>('link');
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

  // Issue an invite and copy either the bare token or a full
  // shareable link to the clipboard, depending on `mode`. Falls back
  // to displaying the value inline if the clipboard write is blocked.
  const issueInvite = async (
    seconds: number,
    mode: 'code' | 'link' = 'code'
  ) => {
    const token = await createInvite(seconds);
    if (!token || !roomId) return;
    const value = mode === 'link' ? buildInviteLink(roomId, token) : token;
    try {
      await navigator.clipboard.writeText(value);
      setInviteFeedback(
        mode === 'link'
          ? 'Invite link copied to clipboard'
          : 'Invite code copied to clipboard'
      );
    } catch {
      setInviteFeedback(value);
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

  // Bucket the live reactions by participant id so each tile only re-renders
  // when its own reactions change. Computed once per `reactions` update.
  const reactionsByPeer = useMemo(() => {
    const m = new Map<string, typeof reactions>();
    for (const r of reactions) {
      const arr = m.get(r.from) ?? [];
      arr.push(r);
      m.set(r.from, arr);
    }
    return m;
  }, [reactions]);

  const selfId = user?.id ?? '';
  const iAmHost = role === 'host';

  // Grid columns scale with participant count: 1 -> 1 col, 2 -> 2,
  // 3-4 -> 2 (1 on mobile), 5-6 -> 3 on md+.
  const gridClass =
    participantCount <= 1
      ? 'grid grid-cols-1'
      : participantCount === 2
        ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
        : participantCount <= 4
          ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
          : 'grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3';

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
      ) : waiting ? (
        // Guest is parked in the waiting room. Render the splash; the
        // hook will flip `waiting` to null once the host approves us, at
        // which point this branch falls through to the in-call UI.
        <WaitingScreen waiting={waiting} onCancel={cancelWaiting} />
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
              <span
                className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300"
                title={`Up to ${MAX_PARTICIPANTS} participants per room`}
              >
                👥 {participantCount} / {MAX_PARTICIPANTS}
              </span>
              {recording.isRecording && (
                <span
                  className="flex items-center gap-1 rounded-full bg-red-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300"
                  title="Recording in progress"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full bg-red-400"
                    style={{ animation: 'recPulse 1s ease-in-out infinite' }}
                  />
                  REC {fmtMmSs(recording.elapsedSec)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {role === 'host' && (
                <div className="relative" ref={inviteWrapperRef}>
                  <button
                    onClick={() => setInvitePanelOpen((o) => !o)}
                    className="relative rounded bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  >
                    📨 Invite
                    {pendingRequests.length > 0 && (
                      <span
                        className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-slate-900"
                        title={`${pendingRequests.length} waiting for approval`}
                      >
                        {pendingRequests.length}
                      </span>
                    )}
                  </button>
                  {invitePanelOpen && (
                    <div
                      className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Pick whether the preset buttons copy a bare
                          code or a full link. Default is link; code is
                          kept for callers who type into the existing
                          "I have an invite code" field. */}
                      <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                        Copy as
                      </p>
                      <div className="mb-2 flex gap-1 rounded-md bg-slate-800 p-0.5 text-[11px]">
                        <button
                          onClick={() => setInviteMode('link')}
                          className={`flex-1 rounded px-2 py-1 ${
                            inviteMode === 'link'
                              ? 'bg-slate-700 text-slate-100'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          🔗 Link
                        </button>
                        <button
                          onClick={() => setInviteMode('code')}
                          className={`flex-1 rounded px-2 py-1 ${
                            inviteMode === 'code'
                              ? 'bg-slate-700 text-slate-100'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          🔢 Code
                        </button>
                      </div>

                      <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                        Expires in
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {INVITE_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            onClick={() => issueInvite(p.seconds, inviteMode)}
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
                              issueInvite(m * 60, inviteMode);
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
                      <div className="mt-3 border-t border-slate-700 pt-3">
                        {/* Waiting-room toggle + inbox lives here so the
                            host's "manage who comes in" tools are one
                            click away, beside invite minting. */}
                        <WaitingRoomPanel
                          enabled={waitingRoomEnabled}
                          onToggleEnabled={setWaitingRoomEnabled}
                          requests={pendingRequests}
                          onApprove={approveRequest}
                          onReject={rejectRequest}
                        />
                      </div>
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
              {/* If clipboard write succeeded we set a friendly message
                  starting with "Invite"; otherwise we set the raw value
                  (token or full URL) so the user can copy it manually. */}
              {inviteFeedback.startsWith('Invite')
                ? inviteFeedback
                : `Invite: ${inviteFeedback}`}
            </p>
          )}

          {/*
            Responsive video grid. `participants` includes the local user as
            the first entry now, so we just map over it directly — no need
            to render localStream separately. Each tile gets its own
            reactions slice and the participant's raise-hand state.
          */}
          <div className={gridClass}>
            {participants.map((p) => (
              <VideoTile
                key={p.id}
                stream={p.stream}
                muted={p.isSelf}
                // Mirror the local camera preview (feels natural), but not
                // when we're broadcasting the screen — flipped text would
                // be confusing.
                mirrored={p.isSelf && !controls.screenOn}
                label={
                  p.isSelf
                    ? controls.screenOn
                      ? 'You (sharing screen)'
                      : 'You'
                    : p.name
                }
                placeholder={
                  p.isSelf
                    ? 'Starting camera…'
                    : p.connectionState === 'failed'
                      ? 'Connection failed'
                      : !p.hasMedia
                        ? 'Connecting…'
                        : ''
                }
                handRaised={p.handRaised}
                reactions={reactionsByPeer.get(p.id)}
              />
            ))}
          </div>

          <ControlBar
            controls={controls}
            recording={recording}
            handRaised={
              participants.find((p) => p.isSelf)?.handRaised ?? false
            }
            onToggleHand={toggleHand}
            onSendReaction={sendReaction}
            onToggleParticipants={() => setParticipantsOpen((o) => !o)}
            participantCount={participantCount}
            onHangUp={hangUp}
          />

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

          <ParticipantSidebar
            open={participantsOpen}
            onClose={() => setParticipantsOpen(false)}
            participants={participants}
            selfId={selfId}
            isHost={iAmHost}
            onLowerAllHands={lowerAllHands}
          />

          <style>{`
            @keyframes recPulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
          `}</style>
        </div>
      )}
    </div>
  );
}

// MM:SS for the header recording chip. Same logic as ControlBar's helper
// but the duplication is intentional — keeps each component freestanding.
function fmtMmSs(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
