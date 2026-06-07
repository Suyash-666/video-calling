// App.tsx
//
// Top-level layout. Three screens, gated by auth state:
//   - auth:        not signed in -> <AuthScreen />
//   - lobby:       signed in, not in a call -> <Lobby />
//   - in-call:     signed in, joined a room -> video tiles + controls
//
// Re-styled to match the new design system. The in-call screen
// maximizes the video grid (less chrome), keeps the room
// identifier and status in a thin top bar, and anchors the
// ControlBar at the bottom center. Chat + participants slide
// in from the right with a 1px hairline border, no shadow.

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
import { ResetPassword } from './components/ResetPassword';
import { MAX_PARTICIPANTS } from './types';
import { buildInviteLink } from './lib/inviteLink';
import { ChevronDownIcon } from './components/Icons';

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
  // guest can paste into the lobby's "Join via invite link" field
  // or open directly to auto-join. Default to link — it's the
  // friendlier share for most cases.
  const [inviteMode, setInviteMode] = useState<'code' | 'link'>('link');
  // Custom-minutes input, in minutes. Empty string means "use a
  // preset".
  const [inviteMinutes, setInviteMinutes] = useState<string>('');
  // Ref to the wrapper that contains BOTH the trigger button and
  // the popover. We use this for the outside-click check below.
  const inviteWrapperRef = useRef<HTMLDivElement | null>(null);

  // Preset windows in seconds. The server clamps to 1 minute ..
  // 7 days, so any of these are safe to send verbatim.
  const INVITE_PRESETS: { label: string; seconds: number }[] = [
    { label: '15 min', seconds: 15 * 60 },
    { label: '1 hour', seconds: 60 * 60 },
    { label: '24 hours', seconds: 24 * 60 * 60 },
  ];

  // Issue an invite and copy either the bare token or a full
  // shareable link to the clipboard, depending on `mode`. Falls
  // back to displaying the value inline if the clipboard write
  // is blocked.
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
          ? 'Invite link copied to clipboard.'
          : 'Invite code copied to clipboard.'
      );
    } catch {
      setInviteFeedback(value);
    }
    setTimeout(() => setInviteFeedback(null), 6000);
    setInvitePanelOpen(false);
    setInviteMinutes('');
  };

  // Close the invite panel on outside click. We use a ref + target
  // check instead of a global `window` listener because the
  // previous implementation re-registered the listener in the
  // same tick as the click that opened the panel, which (under
  // React 18's event ordering) caused the panel to immediately
  // re-close. The target check is also more correct: it ignores
  // clicks on the trigger button itself, not just on the
  // popover.
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

  // Bucket the live reactions by participant id so each tile only
  // re-renders when its own reactions change. Computed once per
  // `reactions` update.
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
  // 3-4 -> 2 (1 on mobile), 5-6 -> 3 on md+. Gap is 1px hairlines
  // rather than 16px so the tiles touch and read as a single
  // surface.
  const gridClass =
    participantCount <= 1
      ? 'grid grid-cols-1'
      : participantCount === 2
        ? 'grid grid-cols-1 sm:grid-cols-2'
        : participantCount <= 4
          ? 'grid grid-cols-1 sm:grid-cols-2'
          : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3';

  // While the initial session is being restored, show a tiny
  // placeholder so we don't flash the auth screen for signed-in
  // users.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center
                      text-small text-ink-500">
        Loading…
      </div>
    );
  }

  // Password-recovery landing page. We check this before the
  // auth-state branching so a signed-out user who clicks the
  // email link can still finish the reset. Supabase puts the
  // one-time token in the URL hash, which the client picks up
  // on its own; the ResetPassword screen listens for the
  // PASSWORD_RECOVERY event and updates the user's password.
  if (window.location.pathname === '/reset-password') {
    return <ResetPassword />;
  }

  return (
    // No outer padding or background color on the root — both
    // pages set their own. The field color is on body, so a flash
    // of unstyled content reads as the page background, not
    // white.
    <div className="min-h-screen w-full">
      {!user ? (
        <AuthScreen />
      ) : waiting ? (
        // Guest is parked in the waiting room. Render the splash;
        // the hook will flip `waiting` to null once the host
        // approves us, at which point this branch falls through
        // to the in-call UI.
        <WaitingScreen waiting={waiting} onCancel={cancelWaiting} />
      ) : !inCall ? (
        <Lobby onJoin={joinRoom} busy={false} error={error} />
      ) : (
        // The in-call screen is a single fixed-height column:
        // thin top bar, the video grid, the floating control bar
        // anchored to the bottom. No page padding — every pixel
        // either belongs to a tile or to the chrome.
        <div className="flex h-screen w-full flex-col">
          {/* ----------------------------------------------------------------
              TOP BAR
              ---------------------------------------------------------------- */}
          <header
            className="relative z-50 flex flex-shrink-0 items-center
                       justify-between border-b border-white/[0.06]
                       bg-field/80 px-6 py-3 backdrop-blur-md"
          >
            <div className="flex items-center gap-6 text-small">
              {/* Wordmark + room id. Mono for the room id so it
                  reads as a system identifier. */}
              <div className="flex items-center gap-2 font-mono
                              tracking-[0.18em] text-ink-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full
                                 bg-accent" />
                <span className="hidden sm:inline">ZOOM&nbsp;MINI</span>
              </div>

              <span className="hidden text-ink-500 sm:inline">/</span>

              <span className="font-mono text-ink-200">
                {roomId}
              </span>

              {role && (
                <span
                  className={`micro-label ${
                    role === 'host' ? 'text-accent' : 'text-ink-500'
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
                className="micro-label text-ink-500"
                title={`Up to ${MAX_PARTICIPANTS} participants per room`}
              >
                <span className="font-mono">{participantCount}</span>
                <span className="mx-1">/</span>
                <span className="font-mono">{MAX_PARTICIPANTS}</span>
              </span>

              {recording.isRecording && (
                <span
                  className="flex items-center gap-2 text-state-error"
                  title="Recording in progress"
                >
                  <span className="live-dot" />
                  <span className="font-mono">
                    {fmtMmSs(recording.elapsedSec)}
                  </span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-6 text-small">
              <span className="text-ink-500">
                {status === 'joining' ? 'Connecting…' : 'Connected'}
              </span>

              {role === 'host' && (
                <div className="relative" ref={inviteWrapperRef}>
                  <button
                    onClick={() => setInvitePanelOpen((o) => !o)}
                    className="action-primary relative"
                    aria-expanded={invitePanelOpen}
                  >
                    Invite
                    {pendingRequests.length > 0 && (
                      <span
                        className="ml-2 inline-flex h-4 min-w-[16px]
                                   items-center justify-center
                                   rounded-full bg-accent px-1
                                   font-mono text-[10px] font-medium
                                   text-field"
                        title={`${pendingRequests.length} waiting for approval`}
                      >
                        {pendingRequests.length}
                      </span>
                    )}
                    <ChevronDownIcon
                      size={12}
                      className={`ml-1 transition-transform duration-180 ease-out ${
                        invitePanelOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {invitePanelOpen && (
                    <div
                      className="absolute right-0 z-30 mt-3 w-80
                                 rounded-lg border border-white/[0.08]
                                 bg-surface p-4"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="micro-label mb-3">COPY AS</p>
                      <div className="mb-4 flex gap-1 rounded-md
                                      border border-white/[0.06] p-0.5">
                        {(['link', 'code'] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => setInviteMode(m)}
                            className={`flex-1 rounded px-3 py-1.5
                                        text-small outline-none
                                        transition-colors duration-180
                                        ease-out
                                        ${
                                          inviteMode === m
                                            ? 'bg-white/[0.04] text-ink-50'
                                            : 'text-ink-500 hover:text-ink-200'
                                        }`}
                          >
                            {m === 'link' ? 'Link' : 'Code'}
                          </button>
                        ))}
                      </div>

                      <p className="micro-label mb-3">EXPIRES IN</p>
                      <div className="grid grid-cols-3 gap-2">
                        {INVITE_PRESETS.map((p) => (
                          <button
                            key={p.label}
                            onClick={() => issueInvite(p.seconds, inviteMode)}
                            className="rounded border border-white/[0.06]
                                       px-2 py-2 text-small text-ink-200
                                       outline-none transition-colors
                                       duration-180 ease-out
                                       hover:border-white/[0.12]
                                       hover:bg-white/[0.02]"
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={10080}
                          value={inviteMinutes}
                          onChange={(e) => setInviteMinutes(e.target.value)}
                          placeholder="custom (minutes)"
                          className="input-bare-sm flex-1"
                        />
                        <button
                          onClick={() => {
                            const m = parseInt(inviteMinutes, 10);
                            if (Number.isFinite(m) && m > 0) {
                              issueInvite(m * 60, inviteMode);
                            }
                          }}
                          disabled={!parseInt(inviteMinutes, 10)}
                          aria-disabled={!parseInt(inviteMinutes, 10)}
                          className="action-primary"
                        >
                          Issue
                        </button>
                      </div>

                      <p className="mt-3 text-micro uppercase
                                   tracking-[0.12em] text-ink-500">
                        Server clamps 1 min — 7 days
                      </p>

                      <div className="mt-4 border-t border-white/[0.06] pt-4">
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
            </div>
          </header>

          {inviteFeedback && (
            <div className="absolute left-1/2 top-20 z-40 -translate-x-1/2
                            rounded-md border border-white/[0.08]
                            bg-surface px-4 py-2 text-small text-ink-50
                            shadow-lg">
              {inviteFeedback.startsWith('Invite')
                ? inviteFeedback
                : `Invite: ${inviteFeedback}`}
            </div>
          )}

          {/* ----------------------------------------------------------------
              VIDEO GRID
              ---------------------------------------------------------------- */}
          <div className="relative flex-1 overflow-hidden">
            <div
              className={`h-full w-full p-3 ${gridClass}
                          [&>*]:min-h-0`}
            >
              {participants.map((p) => (
                <VideoTile
                  key={p.id}
                  stream={p.stream}
                  muted={p.isSelf}
                  // Mirror the local camera preview (feels natural),
                  // but not when we're broadcasting the screen —
                  // flipped text would be confusing.
                  mirrored={p.isSelf && !controls.screenOn}
                  label={
                    p.isSelf
                      ? controls.screenOn
                        ? 'You · sharing screen'
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
          </div>

          {/* ----------------------------------------------------------------
              CONTROL BAR (anchored bottom-center)
              ---------------------------------------------------------------- */}
          <div className="pointer-events-none absolute inset-x-0 bottom-6
                          flex justify-center">
            <div className="pointer-events-auto">
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
                chatUnread={chat.filter((m) => m.from !== selfId).length}
                onToggleChat={() => setChatOpen((o) => !o)}
              />
            </div>
          </div>

          {error && (
            <p className="absolute bottom-24 left-1/2 -translate-x-1/2
                         text-small text-state-error">
              {error}
            </p>
          )}

          <ChatPanel
            open={chatOpen}
            messages={chat}
            loading={chatLoading}
            participants={participants}
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
        </div>
      )}
    </div>
  );
}

// MM:SS for the header recording chip. Same logic as ControlBar's
// helper but the duplication is intentional — keeps each
// component freestanding.
function fmtMmSs(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
