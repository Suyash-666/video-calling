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

  // Whenever the stream changes (or the element mounts), attach it.
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-slate-800 shadow-lg ring-1 ring-slate-700">
      {stream ? (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          // Local preview feels more natural mirrored; remote is true orientation.
          className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-400">
          {placeholder ?? 'Waiting for video…'}
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs">
        {label}
      </span>
    </div>
  );
}
