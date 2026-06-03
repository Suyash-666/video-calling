// components/ControlBar.tsx
// The bottom bar with mute / camera / hang-up buttons.

import type { MediaControls } from '../types';

interface Props {
  controls: MediaControls;
  onHangUp: () => void;
}

export function ControlBar({ controls, onHangUp }: Props) {
  return (
    <div className="flex items-center justify-center gap-3">
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
          // Fire-and-forget: the hook handles its own errors.
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

      <button
        onClick={onHangUp}
        className="rounded-full bg-red-600 px-5 py-3 text-sm font-medium text-white hover:bg-red-500"
      >
        ☎ Hang up
      </button>
    </div>
  );
}
