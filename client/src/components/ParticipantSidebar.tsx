// components/ParticipantSidebar.tsx
//
// Right-rail panel showing who's in the room. Pure presentational
// — every flag (host, mic, cam, hand) comes straight from the
// `participants` array surfaced by useWebRTC, which is itself
// derived from Supabase Realtime presence. That means this
// updates in real time without any extra wiring.
//
// Re-styled: hairline border, monogram avatar (no image), no
// shadows, no emoji. Status is communicated through a small
// hairline-colored dot, not an emoji. The "lower all hands"
// action is a text link with underline, like everywhere else.

import type { Participant } from '../types';
import {
  CloseIcon,
  HandIcon,
  MicIcon,
  MicOffIcon,
  VideoIcon,
  VideoOffIcon,
} from './Icons';

interface Props {
  open: boolean;
  onClose: () => void;
  participants: Participant[];
  selfId: string;
  isHost: boolean;
  onLowerAllHands: () => void;
}

export function ParticipantSidebar({
  open,
  onClose,
  participants,
  selfId,
  isHost,
  onLowerAllHands,
}: Props) {
  const anyHands = participants.some((p) => p.handRaised);

  return (
    <div
      aria-hidden={!open}
      className={`fixed right-0 top-0 z-30 flex h-full w-80
                  transform flex-col border-l border-white/[0.06]
                  bg-field transition-transform duration-240 ease-out
                  ${open ? 'translate-x-0' : 'translate-x-full'}`}
    >
      <header
        className="flex items-center justify-between
                   border-b border-white/[0.06] px-6 py-4"
      >
        <div className="flex flex-col gap-1">
          <p className="micro-label">PARTICIPANTS</p>
          <p className="text-small text-ink-200">
            <span className="font-mono">{participants.length}</span>
            <span className="text-ink-500"> in the room</span>
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-ink-500 outline-none
                     transition-colors duration-180 ease-out
                     hover:text-ink-200"
          aria-label="Close participants panel"
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <ul className="flex-1 overflow-y-auto px-3 py-2">
        {participants.map((p) => (
          <li
            key={p.id}
            className={`flex items-center gap-4 rounded px-3 py-3
                       outline-none transition-colors duration-180
                       ease-out hover:bg-white/[0.02] ${
                         p.handRaised
                           ? 'bg-accent/10 ring-1 ring-accent/30'
                           : ''
                       }`}
          >
            {/* Monogram avatar. The letter is set in mono small-
                caps so two-letter monograms align vertically. */}
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center
                         justify-center rounded-full border
                         border-white/[0.08] font-mono text-small
                         text-ink-200"
            >
              {(p.name?.charAt(0) ?? '?').toUpperCase()}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-body text-ink-50">
                  {p.name}
                </span>
                {p.id === selfId && (
                  <span className="text-micro uppercase
                                 tracking-[0.12em] text-ink-500">
                    you
                  </span>
                )}
                {p.isHost && (
                  <span
                    className="text-micro uppercase
                               tracking-[0.12em] text-accent"
                    title="Room host"
                  >
                    host
                  </span>
                )}
              </div>
              {/* Per-peer connection status (remote only). */}
              {!p.isSelf && p.connectionState !== 'connected' && (
                <p className="mt-1 text-micro uppercase
                            tracking-[0.12em] text-ink-500">
                  {p.connectionState}
                </p>
              )}
            </div>

            {/* Status icons. Only three glyphs are shown:
                  - hand, only when raised (in accent color)
                  - mic, swapped on/off based on p.micOn
                  - camera, swapped on/off based on p.camOn
                Each glyph is wired to live data from the participant
                row, so it flips the moment the underlying flag
                changes — no caching, no debounce. We deliberately
                do NOT show a phone / call icon here: the user is
                in the participants list because they are in the
                call, and a call-state icon was duplicative (and
                read like a "hang up" affordance). */}
            <div className="flex flex-shrink-0 items-center gap-3
                            text-ink-400">
              {p.handRaised && (
                <span
                  className="text-accent"
                  aria-label={`${p.name} has their hand raised`}
                  title="Hand raised"
                >
                  <HandIcon size={14} />
                </span>
              )}

              <span
                className={p.micOn ? 'text-ink-200' : 'text-state-error'}
                title={p.micOn ? 'Mic on' : 'Mic muted'}
                aria-label={p.micOn ? 'Microphone on' : 'Microphone muted'}
              >
                {p.micOn ? <MicIcon size={14} /> : <MicOffIcon size={14} />}
              </span>
              <span
                className={p.camOn ? 'text-ink-200' : 'text-state-error'}
                title={p.camOn ? 'Camera on' : 'Camera off'}
                aria-label={p.camOn ? 'Camera on' : 'Camera off'}
              >
                {p.camOn ? <VideoIcon size={14} /> : <VideoOffIcon size={14} />}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {isHost && (
        <div className="border-t border-white/[0.06] px-6 py-4">
          <button
            onClick={onLowerAllHands}
            disabled={!anyHands}
            aria-disabled={!anyHands}
            className="action-primary"
            title={
              anyHands
                ? 'Drop every raised hand in the room'
                : 'No hands are currently raised'
            }
          >
            Lower all hands
          </button>
        </div>
      )}
    </div>
  );
}
