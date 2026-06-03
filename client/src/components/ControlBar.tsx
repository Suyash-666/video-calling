// components/ControlBar.tsx
// The bottom bar with mute / camera / screen / record / raise / react / hang-up.
// Everything except the reactions popover is a simple button; the
// reactions popover is local UI state.

import { useState } from 'react';
import type { MediaControls, RecordingControls, ReactionEmoji } from '../types';
import { REACTION_EMOJIS } from '../types';

interface Props {
  controls: MediaControls;
  recording: RecordingControls;
  handRaised: boolean;
  onToggleHand: () => void;
  onSendReaction: (emoji: ReactionEmoji) => void;
  onToggleParticipants: () => void;
  participantCount: number;
  onHangUp: () => void;
}

// Format seconds as MM:SS — used by the recording indicator.
function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
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
}: Props) {
  const [reactOpen, setReactOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <button
        onClick={controls.toggleMic}
        className={`rounded-full px-5 py-3 text-sm font-medium transition ${
          controls.micOn
            ? 'bg-slate-700 hover:bg-slate-600'
            : 'bg-red-600 hover:bg-red-500'
        }`}
        aria-label={controls.micOn ? 'Mute microphone' : 'Unmute microphone'}
      >
        {controls.micOn ? '🎙 Mute' : '🔇 Unmute'}
      </button>

      <button
        onClick={controls.toggleCam}
        disabled={controls.screenOn}
        className={`rounded-full px-5 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          controls.camOn
            ? 'bg-slate-700 hover:bg-slate-600'
            : 'bg-red-600 hover:bg-red-500'
        }`}
        aria-label={controls.camOn ? 'Turn camera off' : 'Turn camera on'}
        title={
          controls.screenOn
            ? 'Camera is paused while screen sharing'
            : undefined
        }
      >
        {controls.camOn ? '📷 Camera off' : '🚫 Camera on'}
      </button>

      <button
        onClick={() => {
          void controls.toggleScreenShare();
        }}
        className={`rounded-full px-5 py-3 text-sm font-medium transition ${
          controls.screenOn
            ? 'bg-emerald-600 hover:bg-emerald-500'
            : 'bg-slate-700 hover:bg-slate-600'
        }`}
        aria-label={controls.screenOn ? 'Stop sharing screen' : 'Share screen'}
      >
        {controls.screenOn ? '🛑 Stop sharing' : '🖥 Share screen'}
      </button>

      {/* Background blur toggle. Disabled while screen sharing (the
          screen track is what peers want to see, not the camera). First
          tap loads the segmentation model (~2.5MB), so we surface a
          loading state. */}
      <button
        onClick={() => {
          void controls.toggleBlur();
        }}
        disabled={controls.screenOn || controls.blurLoading}
        className={`rounded-full px-5 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          controls.blurOn
            ? 'bg-indigo-600 hover:bg-indigo-500'
            : 'bg-slate-700 hover:bg-slate-600'
        }`}
        aria-pressed={controls.blurOn}
        aria-label={controls.blurOn ? 'Turn off background blur' : 'Blur background'}
        title={
          controls.screenOn
            ? 'Blur is unavailable during screen sharing'
            : undefined
        }
      >
        {controls.blurLoading
          ? '⏳ Loading…'
          : controls.blurOn
            ? '✨ Blur on'
            : '🌫 Blur'}
      </button>

      {/* Record toggle with live MM:SS while recording. */}
      <button
        onClick={() => {
          if (recording.isRecording) recording.stopRecording();
          else void recording.startRecording();
        }}
        className={`flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition ${
          recording.isRecording
            ? 'bg-red-600 hover:bg-red-500'
            : 'bg-slate-700 hover:bg-slate-600'
        }`}
        aria-label={
          recording.isRecording ? 'Stop recording' : 'Start recording'
        }
      >
        {recording.isRecording ? (
          <>
            <span
              className="inline-block h-2.5 w-2.5 rounded-full bg-white"
              style={{ animation: 'recPulse 1s ease-in-out infinite' }}
            />
            <span className="tabular-nums">
              {fmtElapsed(recording.elapsedSec)}
            </span>
            <span>Stop</span>
          </>
        ) : (
          <>⏺ Record</>
        )}
      </button>

      {/* Raise / lower own hand. */}
      <button
        onClick={onToggleHand}
        className={`rounded-full px-5 py-3 text-sm font-medium transition ${
          handRaised
            ? 'bg-amber-500 text-slate-900 hover:bg-amber-400'
            : 'bg-slate-700 hover:bg-slate-600'
        }`}
        aria-pressed={handRaised}
        aria-label={handRaised ? 'Lower hand' : 'Raise hand'}
      >
        ✋ {handRaised ? 'Lower hand' : 'Raise hand'}
      </button>

      {/* Reactions popover. */}
      <div className="relative">
        <button
          onClick={() => setReactOpen((o) => !o)}
          className="rounded-full bg-slate-700 px-5 py-3 text-sm font-medium hover:bg-slate-600"
          aria-haspopup="menu"
          aria-expanded={reactOpen}
        >
          😀 React
        </button>
        {reactOpen && (
          <div
            className="absolute bottom-full left-1/2 z-30 mb-2 flex -translate-x-1/2 gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-1 shadow-xl"
            role="menu"
          >
            {REACTION_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  onSendReaction(e);
                  setReactOpen(false);
                }}
                className="rounded-full px-2 py-1 text-2xl transition hover:bg-slate-700"
                aria-label={`Send ${e}`}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onToggleParticipants}
        className="rounded-full bg-slate-700 px-5 py-3 text-sm font-medium hover:bg-slate-600"
        aria-label="Toggle participants panel"
      >
        👥 {participantCount}
      </button>

      <button
        onClick={onHangUp}
        className="rounded-full bg-red-600 px-5 py-3 text-sm font-medium text-white hover:bg-red-500"
      >
        ☎ Hang up
      </button>

      <style>{`
        @keyframes recPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
