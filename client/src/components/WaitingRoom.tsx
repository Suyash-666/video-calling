// components/WaitingRoom.tsx
//
// Two paired pieces for the waiting-room feature:
//   - <WaitingScreen> : full-screen splash a guest sees while they
//                       wait for the host to approve them.
//   - <WaitingRoomPanel>: host-side inbox of pending requests with
//                         approve / reject buttons.
//
// Both are pure presentational — every bit of state comes from
// the useWebRTC hook, which already wires the Realtime
// subscriptions. Re-styled to match the new system: no card
// chrome, no shadows, no emoji.

import { useEffect, useState } from 'react';
import type { PendingRequest, WaitingState } from '../types';
import { ArrowRightIcon, CloseIcon, HandIcon } from './Icons';

// --- Guest splash --------------------------------------------------------

interface WaitingScreenProps {
  waiting: WaitingState;
  onCancel: () => void;
}

export function WaitingScreen({ waiting, onCancel }: WaitingScreenProps) {
  // Live-tick MM:SS since we started waiting. setInterval is fine
  // — we don't need sub-second precision and the page is
  // otherwise idle.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - waiting.startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [waiting.startedAt]);

  const rejected = waiting.status === 'rejected';

  return (
    <div className="flex min-h-screen w-full items-center
                    justify-center px-8">
      <div className="w-full max-w-md">
        {rejected ? (
          <>
            <p className="micro-label mb-6 text-state-error">
              REQUEST DECLINED
            </p>
            <h1 className="display-md text-ink-50">
              The host said no.
            </h1>
            <p className="mt-6 max-w-sm text-body text-ink-400">
              Try a different room, or ask the host to mint you a
              fresh invite.
            </p>
            <button
              onClick={onCancel}
              className="action-primary mt-12"
            >
              Back to lobby
              <ArrowRightIcon size={14} className="opacity-60" />
            </button>
          </>
        ) : (
          <>
            <p className="micro-label mb-6 text-accent">WAITING</p>
            <h1 className="display-md text-ink-50">
              Hold on a moment.
            </h1>
            <p className="mt-6 max-w-sm text-body text-ink-400">
              The host hasn't approved your request yet. We'll put
              you in as soon as they do.
            </p>
            <div className="mt-12 flex items-center gap-6">
              <div className="flex items-center gap-3">
                <span className="live-dot" />
                <span className="font-mono text-small text-ink-200">
                  {waiting.roomId}
                </span>
              </div>
              <span className="font-mono text-small text-ink-500">
                {formatMmSs(elapsed)} elapsed
              </span>
            </div>
            <button
              onClick={onCancel}
              className="action-secondary mt-12 inline-flex
                         items-center gap-2"
            >
              <CloseIcon size={14} />
              Cancel request
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --- Host inbox ----------------------------------------------------------

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
  // Click guard so a double-click doesn't fire two RPCs against
  // the same row.
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="micro-label">WAITING ROOM</p>
          <p className="mt-1 text-small text-ink-400">
            {enabled
              ? 'Guests must be approved before joining.'
              : 'Off — anyone with a valid invite joins immediately.'}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-3
                          text-small text-ink-400 outline-none
                          transition-colors duration-180 ease-out
                          hover:text-ink-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              void onToggleEnabled(e.target.checked);
            }}
            className="h-3 w-3 cursor-pointer accent-accent"
          />
          {enabled ? 'On' : 'Off'}
        </label>
      </div>

      {enabled && (
        <div>
          {requests.length === 0 ? (
            <p className="py-4 text-center text-small text-ink-500">
              No one is waiting.
            </p>
          ) : (
            <ul className="flex flex-col">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-4
                             border-t border-white/[0.06] py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <HandIcon size={14} className="text-accent" />
                    <div className="min-w-0">
                      <p className="truncate text-body text-ink-200">
                        {r.displayName ??
                          `User ${r.userId.slice(0, 6)}`}
                      </p>
                      <p className="text-micro uppercase
                                   tracking-[0.12em] text-ink-500">
                        asked {timeAgo(r.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => wrap(r.id, () => onReject(r.id))}
                      disabled={busy.has(r.id)}
                      aria-disabled={busy.has(r.id)}
                      className="action-secondary text-small"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => wrap(r.id, () => onApprove(r.id))}
                      disabled={busy.has(r.id)}
                      aria-disabled={busy.has(r.id)}
                      className="action-primary text-small"
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
