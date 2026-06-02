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
        className={`rounded-full px-5 py-3 text-sm font-medium transition ${
          controls.camOn
            ? 'bg-slate-700 hover:bg-slate-600'
            : 'bg-red-600 hover:bg-red-500'
        }`}
        aria-label={controls.camOn ? 'Turn camera off' : 'Turn camera on'}
      >
        {controls.camOn ? '📷 Camera off' : '🚫 Camera on'}
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
