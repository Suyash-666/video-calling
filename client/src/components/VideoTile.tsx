// components/VideoTile.tsx
// Reusable tile that shows a video stream and a small label.
// Also renders two transient overlays driven by useWebRTC:
//   - A raised-hand badge in the top-right corner.
//   - Floating reaction emojis that drift upward and fade out.

import { useEffect, useRef } from 'react';
import type { Reaction } from '../types';

interface Props {
  stream: MediaStream | null;
  muted: boolean;
  label: string;
  mirrored?: boolean;
  placeholder?: string;
  handRaised?: boolean;
  // Live reactions to render in this tile. Caller passes the subset of
  // `reactions` matching this participant's id.
  reactions?: Reaction[];
}

export function VideoTile({
  stream,
  muted,
  label,
  mirrored,
  placeholder,
  handRaised,
  reactions,
}: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);

  // We always render the <video> element (even when stream is null) so
  // that ref.current is available before the stream arrives. The
  // placeholder is drawn as an overlay instead of replacing the video.
  // This avoids a race where the <video> mounts in the same render as
  // the stream arrives, and the effect sees ref.current === null.
  //
  // We attach srcObject on every render where the desired value differs
  // from what's currently attached — using a manual === check rather
  // than relying on the dep array, because MediaStream identity can be
  // stable across React re-renders even when its track set has changed
  // (e.g. ontrack firing twice: once for audio, once for video).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream;
    }
    // Some browsers (Safari, mobile) need an explicit play() kick after
    // srcObject is set. autoPlay handles it on Chrome desktop but not
    // always elsewhere. play() rejects if there's nothing to play yet;
    // we swallow the error rather than logging because it's expected.
    if (stream) {
      el.play().catch(() => {
        /* expected when stream has no active tracks yet */
      });
    }
  });

  return (
    // The tile is a flat surface with no shadow and no ring.
    // 1px hairline border defines the edge; 4px radius keeps it
    // from looking like a window. The video fills the entire
    // surface; the label and hand badge sit on top with a quiet
    // gradient at the bottom edge so the label is readable
    // against any background.
    <div className="relative aspect-video w-full overflow-hidden
                    rounded border border-white/[0.06] bg-ink-700">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        // Local preview feels more natural mirrored; remote is
        // true orientation.
        className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''} ${
          stream ? '' : 'invisible'
        }`}
      />
      {!stream && (
        <div className="absolute inset-0 flex items-center
                       justify-center text-small text-ink-500">
          {placeholder ?? 'Connecting…'}
        </div>
      )}

      {/* Bottom gradient for label readability. Pure CSS, very
          subtle so it doesn't fight the video. */}
      <div className="pointer-events-none absolute inset-x-0
                      bottom-0 h-20 bg-gradient-to-t
                      from-black/40 to-transparent" />

      {/* Raised-hand badge — a prominent amber pill in the top-right
          with the hand icon and label, plus a pulsing live dot. We
          scale it up (vs. the previous micro-pill) so it's visible
          at a glance across the grid, and add a soft amber ring
          around the whole tile so a raised hand is unmissable even
          from the corner of the eye. The ring uses a CSS animation
          defined alongside the reactionFloat keyframes below. */}
      {handRaised && (
        <>
          <span
            className="pointer-events-none absolute inset-0
                       rounded ring-2 ring-accent/70
                       hand-ring"
            aria-hidden="true"
          />
          <span
            className="absolute right-3 top-3 z-10 flex
                       items-center gap-2 rounded-full
                       bg-accent px-3 py-1.5 text-small
                       font-medium text-field shadow-md
                       shadow-accent/20"
            aria-label="Hand raised"
          >
            <HandGlyph />
            <span className="font-mono uppercase tracking-wide">
              Hand
            </span>
          </span>
        </>
      )}

      {/* Reaction overlay — emojis float up from the bottom and
          fade. Kept for parity with the prior behavior. */}
      <div className="pointer-events-none absolute inset-x-0
                      bottom-0 h-1/2 overflow-hidden">
        {(reactions ?? []).map((r) => (
          <span
            key={r.id}
            className="absolute bottom-2 select-none text-4xl"
            // Spread reactions across the tile width
            // pseudo-randomly via the uuid. Deterministic per
            // reaction (no re-pick on rerender).
            style={{
              left: `${10 + hashTo01(r.id) * 80}%`,
              animation: 'reactionFloat 3s ease-out forwards',
            }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      {/* Participant label. Bottom-left, micro type, no
          background plate — the gradient below provides
          contrast. */}
      <span className="absolute bottom-2 left-3 text-small
                      font-medium text-ink-50">
        {label}
      </span>

      <style>{`
        @keyframes reactionFloat {
          0%   { transform: translateY(0)     scale(0.6); opacity: 0; }
          15%  { transform: translateY(-20px) scale(1.1); opacity: 1; }
          80%  { transform: translateY(-160px) scale(1);  opacity: 1; }
          100% { transform: translateY(-200px) scale(0.9); opacity: 0; }
        }
        @keyframes handRing {
          0%   { box-shadow: 0 0 0 0   rgba(255, 180, 84, 0.55); }
          70%  { box-shadow: 0 0 0 10px rgba(255, 180, 84, 0);    }
          100% { box-shadow: 0 0 0 0   rgba(255, 180, 84, 0);    }
        }
        .hand-ring {
          animation: handRing 1.6s ease-out infinite;
        }
      `}</style>
    </div>
  );
}

// Cheap deterministic 0..1 from any string. Used so each reaction picks
// a stable horizontal slot. We avoid Math.random() so the position
// doesn't jump between renders.
function hashTo01(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 1000) / 1000;
}

// Inline hand glyph for the raised-hand badge. Same visual language
// as the Icons module's HandIcon, but tinted to sit on the accent
// fill (dark) rather than on the field (light).
function HandGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v6" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}
