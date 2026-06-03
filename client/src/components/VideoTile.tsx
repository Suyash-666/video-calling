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
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-800 shadow-lg ring-1 ring-slate-700">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        // Local preview feels more natural mirrored; remote is true orientation.
        className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''} ${
          stream ? '' : 'invisible'
        }`}
      />
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400">
          {placeholder ?? 'Waiting for video…'}
        </div>
      )}

      {/* Raised-hand badge — animated wave. */}
      {handRaised && (
        <span
          className="absolute right-2 top-2 select-none rounded-full bg-amber-500/90 px-2 py-1 text-lg shadow"
          style={{ animation: 'handWave 1.2s ease-in-out infinite' }}
          aria-label="Hand raised"
        >
          ✋
        </span>
      )}

      {/* Reaction overlay — emojis float up from the bottom and fade. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 overflow-hidden">
        {(reactions ?? []).map((r) => (
          <span
            key={r.id}
            className="absolute bottom-2 select-none text-4xl"
            // Spread reactions across the tile width pseudo-randomly via
            // the uuid. Deterministic per reaction (no re-pick on rerender).
            style={{
              left: `${10 + hashTo01(r.id) * 80}%`,
              animation: 'reactionFloat 3s ease-out forwards',
            }}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs">
        {label}
      </span>

      <style>{`
        @keyframes handWave {
          0%, 100% { transform: rotate(-10deg); }
          50% { transform: rotate(20deg); }
        }
        @keyframes reactionFloat {
          0%   { transform: translateY(0)     scale(0.6); opacity: 0; }
          15%  { transform: translateY(-20px) scale(1.1); opacity: 1; }
          80%  { transform: translateY(-160px) scale(1);  opacity: 1; }
          100% { transform: translateY(-200px) scale(0.9); opacity: 0; }
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
