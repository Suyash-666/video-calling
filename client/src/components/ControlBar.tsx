// components/ControlBar.tsx
//
// The in-call control surface. Re-styled to match the new design
// system: a single hairline-bordered pill, anchored to the bottom
// of the screen, with icon-only buttons. Buttons gain a subtle
// filled background when active. The hang-up control is a
// distinct red square on the right edge of the pill — the only
// color in the control surface, by design.
//
// No emoji. The previous version had 🎙 🔇 📷 🚫 🖥 ✨ etc. as
// button labels; emoji read as casual. The new icons are
// stroked SVGs from ./Icons, the same set used elsewhere.

import { useState } from 'react';
import type { MediaControls, RecordingControls, ReactionEmoji } from '../types';
import { REACTION_EMOJIS } from '../types';
import {
  BlurIcon,
  ChatIcon,
  CloseIcon,
  HandIcon,
  HangupIcon,
  MicIcon,
  MicOffIcon,
  PeopleIcon,
  ScreenIcon,
  VideoIcon,
  VideoOffIcon,
} from './Icons';

interface Props {
  controls: MediaControls;
  recording: RecordingControls;
  handRaised: boolean;
  onToggleHand: () => void;
  onSendReaction: (emoji: ReactionEmoji) => void;
  onToggleParticipants: () => void;
  participantCount: number;
  onHangUp: () => void;
  // Chat is opened from a slide-in panel, not from the bar. We
  // keep the count in the icon for at-a-glance feedback.
  chatUnread?: number;
  onToggleChat?: () => void;
}

// Format seconds as MM:SS — used by the recording indicator.
function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// PillButton: the atomic control. Icon-only, 40x40 square, with
// three visual states: default (no background), active (ink-700
// background, used for "this thing is on"), and danger (red,
// used only for "this thing is off — fix it"). Hover lifts the
// icon color from ink-400 to ink-50.
function PillButton({
  active,
  activeColor = 'ink',
  danger,
  disabled,
  onClick,
  title,
  ariaLabel,
  ariaPressed,
  children,
}: {
  active?: boolean;
  activeColor?: 'ink' | 'amber';
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  ariaLabel: string;
  ariaPressed?: boolean;
  children: React.ReactNode;
}) {
  // Three background colors keyed to state. The amber color is
  // used only for raise-hand (the only positive "raise" gesture
  // in the bar) — it earns the accent.
  const bg = active
    ? activeColor === 'amber'
      ? 'bg-accent/15 text-accent'
      : 'bg-ink-700 text-ink-50'
    : danger
      ? 'bg-state-error/15 text-state-error'
      : 'text-ink-400 hover:text-ink-50 hover:bg-white/[0.04]';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      title={title}
      className={`flex h-10 w-10 items-center justify-center rounded-full
                  outline-none transition-colors duration-180 ease-out
                  disabled:cursor-not-allowed disabled:opacity-30 ${bg}`}
    >
      {children}
    </button>
  );
}

// Tooltip: shown on hover/focus of an icon-only control. We
// implement our own (rather than using the platform title attr) so
// the appearance matches the design system: a hairline-bordered
// pill in micro type, no shadow, no animation, and a 120ms fade
// in. The platform title attr is kept on the button as a fallback
// for users on devices that swallow hover.
//
// Visibility is driven purely by `group-hover` and `group-focus-within`.
// We deliberately do NOT flip a "hidden" flag on pointerdown: the
// button is itself a child of the wrapper, so `onPointerDown` would
// fire the instant the user moves onto the button, hiding the
// tooltip just as the user is reading it. A fresh hover or focus
// shows it again. Click-to-dismiss is therefore implicit in the
// hover-out cycle.
function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="group relative flex">
      {children}
      <span
        // The tooltip sits above the bar with a 6px gap. It's
        // pointer-events-none so it never intercepts the click
        // meant for the button underneath, and `whitespace-nowrap`
        // keeps multi-word labels from wrapping.
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2
                    mb-2 -translate-x-1/2 whitespace-nowrap rounded
                    border border-white/[0.08] bg-surface
                    px-2 py-1 font-mono text-[11px] uppercase
                    tracking-[0.08em] text-ink-200
                    transition-opacity duration-120 ease-out
                    opacity-0 group-hover:opacity-100
                    group-focus-within:opacity-100`}
      >
        {label}
      </span>
    </div>
  );
}

export function ControlBar({
  controls,
  recording,
  handRaised,
  onToggleHand,
  onSendReaction,
  onToggleParticipants,
  participantCount,
  onHangUp,
  chatUnread = 0,
  onToggleChat,
}: Props) {
  const [reactOpen, setReactOpen] = useState(false);

  return (
    // The bar is a single rounded-full pill with a hairline
    // border. It floats above the bottom of the viewport by 24px
    // (the parent in App.tsx positions it). The pill is centered
    // horizontally.
    <div className="flex items-center gap-1 rounded-full border
                    border-white/[0.08] bg-surface/90 px-2 py-1.5
                    backdrop-blur-md">
      {/* Mic. Off state shows the crossed-out icon and a subtle
          red wash — a small cue that audio isn't flowing. */}
      <Tooltip label={controls.micOn ? 'Mute' : 'Unmute'}>
        <PillButton
          onClick={controls.toggleMic}
          active={controls.micOn}
          danger={!controls.micOn}
          ariaLabel={controls.micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {controls.micOn ? <MicIcon /> : <MicOffIcon />}
        </PillButton>
      </Tooltip>

      {/* Camera. Same pattern. Disabled while screen sharing
          because we replace the sender's track with the screen
          track, so the camera is "paused". */}
      <Tooltip
        label={
          controls.screenOn
            ? 'Paused while sharing'
            : controls.camOn
              ? 'Turn camera off'
              : 'Turn camera on'
        }
      >
        <PillButton
          onClick={controls.toggleCam}
          disabled={controls.screenOn}
          active={controls.camOn}
          danger={!controls.camOn}
          title={
            controls.screenOn
              ? 'Camera is paused while screen sharing'
              : undefined
          }
          ariaLabel={controls.camOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {controls.camOn ? <VideoIcon /> : <VideoOffIcon />}
        </PillButton>
      </Tooltip>

      {/* Screen share. Active state shows the same icon in the
          "ink-700" background — there is no separate "stop" icon
          in the new system. Tapping again stops the share. */}
      <Tooltip label={controls.screenOn ? 'Stop sharing' : 'Share screen'}>
        <PillButton
          onClick={() => void controls.toggleScreenShare()}
          active={controls.screenOn}
          ariaLabel={controls.screenOn ? 'Stop sharing screen' : 'Share screen'}
        >
          <ScreenIcon />
        </PillButton>
      </Tooltip>

      {/* Background blur. Uses the accent-soft background when
          on — this is the one place the amber accent reappears
          in the control bar, because blur is a positive "look
          better" feature rather than a control state. */}
      <Tooltip
        label={
          controls.screenOn
            ? 'Unavailable while sharing'
            : controls.blurOn
              ? 'Turn blur off'
              : 'Blur background'
        }
      >
        <PillButton
          onClick={() => void controls.toggleBlur()}
          disabled={controls.screenOn || controls.blurLoading}
          active={controls.blurOn}
          activeColor="amber"
          title={
            controls.screenOn
              ? 'Blur is unavailable during screen sharing'
              : undefined
          }
          ariaPressed={controls.blurOn}
          ariaLabel={
            controls.blurOn ? 'Turn off background blur' : 'Blur background'
          }
        >
          <BlurIcon />
        </PillButton>
      </Tooltip>

      {/* Recording. The active state shows a pulsing live dot
          and a tabular-num MM:SS. Tapping stops. We don't gate on
          a separate `loading` flag (RecordingControls doesn't
          expose one) — `isRecording` is the source of truth, and
          the async startRecording call won't double-fire because
          the hook flips isRecording true synchronously on click. */}
      <Tooltip label={recording.isRecording ? 'Stop recording' : 'Start recording'}>
        <button
          onClick={() => {
            if (recording.isRecording) recording.stopRecording();
            else void recording.startRecording();
          }}
          className={`flex h-10 items-center gap-2 rounded-full px-3
                      text-small font-medium outline-none
                      transition-colors duration-180 ease-out
                      ${
                        recording.isRecording
                          ? 'bg-state-error/15 text-state-error'
                          : 'text-ink-400 hover:bg-white/[0.04] hover:text-ink-50'
                      }`}
          aria-label={recording.isRecording ? 'Stop recording' : 'Start recording'}
        >
          {recording.isRecording ? (
            <>
              <span className="live-dot" />
              <span className="font-mono">{fmtElapsed(recording.elapsedSec)}</span>
            </>
          ) : (
            <span className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
              Rec
            </span>
          )}
        </button>
      </Tooltip>

      {/* Vertical divider. A 1px hairline at the visual center of
          the pill, 24px tall, separating the media controls
          (left) from the social controls (right). */}
      <div className="mx-2 h-6 w-px bg-white/[0.06]" />

      {/* Raise hand. Active state uses the amber accent — the
          only positive highlight in the bar. */}
      <Tooltip label={handRaised ? 'Lower hand' : 'Raise hand'}>
        <PillButton
          onClick={onToggleHand}
          active={handRaised}
          activeColor="amber"
          ariaPressed={handRaised}
          ariaLabel={handRaised ? 'Lower hand' : 'Raise hand'}
        >
          <HandIcon />
        </PillButton>
      </Tooltip>

      {/* Reactions popover. The popover floats above the bar; we
          close it after a selection. The popover uses a similar
          pill style to the bar itself so it visually belongs. */}
      <div className="relative">
        <Tooltip label="React">
          <PillButton
            onClick={() => setReactOpen((o) => !o)}
            ariaLabel="Send reaction"
          >
            <span className="text-body leading-none">☺</span>
          </PillButton>
        </Tooltip>
        {reactOpen && (
          <div
            className="absolute bottom-full left-1/2 z-30 mb-2
                       flex -translate-x-1/2 gap-1 rounded-full
                       border border-white/[0.08] bg-surface
                       px-2 py-1.5"
            role="menu"
          >
            {REACTION_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  onSendReaction(e);
                  setReactOpen(false);
                }}
                className="rounded-full px-2 py-1 text-xl outline-none
                           transition-colors duration-180 ease-out
                           hover:bg-white/[0.06]"
                aria-label={`Send ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chat. Optional — the chat panel may not be openable
          from this build yet. Show a small unread count if any. */}
      {onToggleChat && (
        <Tooltip label="Chat">
          <PillButton
            onClick={onToggleChat}
            ariaLabel="Toggle chat"
          >
            <span className="relative">
              <ChatIcon />
              {chatUnread > 0 && (
                <span
                  className="absolute -right-2 -top-2
                             min-w-[16px] rounded-full
                             bg-accent px-1 text-center
                             font-mono text-[10px] font-medium
                             text-field"
                >
                  {chatUnread}
                </span>
              )}
            </span>
          </PillButton>
        </Tooltip>
      )}

      {/* Participants. The count renders next to the icon. */}
      <Tooltip label="Participants">
        <PillButton
          onClick={onToggleParticipants}
          ariaLabel="Toggle participants panel"
        >
          <span className="flex items-center gap-1.5">
            <PeopleIcon />
            <span className="font-mono text-small">{participantCount}</span>
          </span>
        </PillButton>
      </Tooltip>

      {/* Hangup. Visually separated from the rest of the pill by
          a thin divider and rendered as a red square. The
          squareness is intentional: the pill is a friendly
          control surface, the red square is a terminal action. */}
      <div className="mx-2 h-6 w-px bg-white/[0.06]" />
      <Tooltip label="Leave call">
        <button
          onClick={onHangUp}
          aria-label="Hang up"
          className="flex h-10 w-10 items-center justify-center
                     rounded-md bg-state-error/90 text-white
                     outline-none transition-colors duration-180 ease-out
                     hover:bg-state-error"
        >
          <HangupIcon />
        </button>
      </Tooltip>
    </div>
  );
}
