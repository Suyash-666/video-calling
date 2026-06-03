// components/WaitingRoom.tsx
// Two paired pieces for the waiting-room feature:
//   - <WaitingScreen> : full-screen splash a guest sees while they wait
//                       for the host to approve them.
//   - <WaitingRoomPanel>: host-side inbox of pending requests with
//                         approve / reject buttons.
//
// Both are pure presentational — every bit of state comes from the
// useWebRTC hook, which already wires the Realtime subscriptions.

import { useEffect, useState } from 'react';
import type { PendingRequest, WaitingState } from '../types';

// --- Guest splash ---------------------------------------------------------

interface WaitingScreenProps {
  waiting: WaitingState;
  onCancel: () => void;
}

export function WaitingScreen({ waiting, onCancel }: WaitingScreenProps) {
  // Live-tick MM:SS since we started waiting. setInterval is fine — we
  // don't need sub-second precision and the page is otherwise idle.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - waiting.startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [waiting.startedAt]);

  const rejected = waiting.status === 'rejected';

  return (
    <div className="flex min-h-[80vh] w-full items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
        {rejected ? (
          <>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-900/40 text-3xl">
              ✋
            </div>
            <h2 className="text-lg font-semibold text-slate-200">
              The host declined your request
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              You can try a different room or ask the host for a new invite.
            </p>
            <button
              onClick={onCancel}
              className="mt-6 w-full rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
            >
              Back to lobby
            </button>
          </>
        ) : (
          <>
            <div
              className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-3xl"
              style={{ animation: 'pulseRing 1.6s ease-in-out infinite' }}
            >
              ⌛
            </div>
            <h2 className="text-lg font-semibold text-slate-200">
              Waiting for the host to let you in
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Room <span className="font-mono">{waiting.roomId}</span>
            </p>
            <p className="mt-3 text-xs tabular-nums text-slate-500">
              {formatMmSs(elapsed)} elapsed
            </p>
            <button
              onClick={onCancel}
              className="mt-6 w-full rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulseRing {
          0%   { box-shadow: 0 0 0 0 rgba(99,102,241,0.5); }
          70%  { box-shadow: 0 0 0 14px rgba(99,102,241,0); }
          100% { box-shadow: 0 0 0 0 rgba(99,102,241,0); }
        }
      `}</style>
    </div>
  );
}

// --- Host inbox -----------------------------------------------------------

interface WaitingRoomPanelProps {
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => Promise<void>;
  requests: PendingRequest[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function WaitingRoomPanel({
  enabled,
  onToggleEnabled,
  requests,
  onApprove,
  onReject,
}: WaitingRoomPanelProps) {
  // Click guard so a double-click doesn't fire two RPCs against the same row.
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const wrap = async (id: string, fn: () => Promise<void>) => {
    setBusy((s) => new Set(s).add(id));
    try {
      await fn();
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Waiting room
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {enabled
              ? 'Guests must be approved before joining.'
              : 'Off — anyone with a valid invite joins immediately.'}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              void onToggleEnabled(e.target.checked);
            }}
            className="h-4 w-4 accent-emerald-500"
          />
          {enabled ? 'On' : 'Off'}
        </label>
      </div>

      {enabled && (
        <div className="mt-3">
          {requests.length === 0 ? (
            <p className="text-center text-xs text-slate-500">
              No one is waiting.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md bg-slate-800/60 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">
                      {r.displayName ?? `User ${r.userId.slice(0, 6)}`}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      asked {timeAgo(r.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => wrap(r.id, () => onReject(r.id))}
                      disabled={busy.has(r.id)}
                      className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-600 disabled:opacity-40"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => wrap(r.id, () => onApprove(r.id))}
                      disabled={busy.has(r.id)}
                      className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                    >
                      Admit
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// --- Helpers --------------------------------------------------------------

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
