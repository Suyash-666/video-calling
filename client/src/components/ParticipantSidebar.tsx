// components/ParticipantSidebar.tsx
// Right-rail panel showing who's in the room. Pure presentational —
// every flag (host, mic, cam, hand) comes straight from the
// `participants` array surfaced by useWebRTC, which is itself derived
// from Supabase Realtime presence. That means this updates in real time
// without any extra wiring.

import type { Participant } from '../types';

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
      className={`fixed right-0 top-0 z-30 flex h-full w-72 transform flex-col bg-slate-900 shadow-2xl ring-1 ring-slate-700 transition-transform ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Participants</h2>
          <p className="text-[10px] uppercase tracking-wider text-slate-500">
            {participants.length} in the room
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          aria-label="Close participants panel"
        >
          ×
        </button>
      </header>

      <ul className="flex-1 overflow-y-auto px-2 py-2">
        {participants.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-slate-800/60"
          >
            {/* Avatar — first letter of name. */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold uppercase text-slate-200">
              {p.name.charAt(0) || '?'}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm text-slate-200">
                  {p.name}
                  {p.id === selfId && (
                    <span className="ml-1 text-[10px] text-slate-500">(you)</span>
                  )}
                </span>
                {p.isHost && (
                  <span
                    className="rounded-sm bg-emerald-900/60 px-1 py-0.5 text-[9px] font-semibold uppercase text-emerald-300"
                    title="Room host"
                  >
                    host
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                {/* Per-peer connection status (remote only). */}
                {!p.isSelf && p.connectionState !== 'connected' && (
                  <span className="text-amber-400">{p.connectionState}</span>
                )}
              </div>
            </div>

            {/* Raise hand indicator — animated wave when active. */}
            {p.handRaised && (
              <span
                aria-label={`${p.name} has their hand raised`}
                className="text-lg"
                style={{ animation: 'handWave 1.2s ease-in-out infinite' }}
              >
                ✋
              </span>
            )}

            {/* Mic + cam status icons. Greyed = off. */}
            <span
              className={`text-sm ${p.micOn ? 'text-slate-200' : 'text-red-400'}`}
              title={p.micOn ? 'Mic on' : 'Mic muted'}
            >
              {p.micOn ? '🎙' : '🔇'}
            </span>
            <span
              className={`text-sm ${p.camOn ? 'text-slate-200' : 'text-red-400'}`}
              title={p.camOn ? 'Camera on' : 'Camera off'}
            >
              {p.camOn ? '📷' : '🚫'}
            </span>
          </li>
        ))}
      </ul>

      {isHost && (
        <div className="border-t border-slate-700 px-3 py-2">
          <button
            onClick={onLowerAllHands}
            disabled={!anyHands}
            className="w-full rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              anyHands
                ? 'Drop every raised hand in the room'
                : 'No hands are currently raised'
            }
          >
            ✋ Lower all hands
          </button>
        </div>
      )}

      {/*
        Inline keyframes for the hand wave. Kept here so the component
        is self-contained — no global CSS dependency.
      */}
      <style>{`
        @keyframes handWave {
          0%, 100% { transform: rotate(-10deg); }
          50% { transform: rotate(20deg); }
        }
      `}</style>
    </div>
  );
}
