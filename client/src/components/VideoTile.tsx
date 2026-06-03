// components/VideoTile.tsx
// Reusable tile that shows a video stream and a small label.

import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  muted: boolean;
  label: string;
  mirrored?: boolean;
  placeholder?: string;
}

export function VideoTile({ stream, muted, label, mirrored, placeholder }: Props) {
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
      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs">
        {label}
      </span>
    </div>
  );
}
