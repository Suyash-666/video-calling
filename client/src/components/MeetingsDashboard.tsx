// components/MeetingsDashboard.tsx
// Lobby-side panel: list of upcoming + recent scheduled meetings,
// inline form to create a new one, copy-link, cancel, and a "Join"
// button that enables only inside the meeting's join window.
//
// Data + actions come from useMeetings. Joining is handed back to the
// parent via onJoin (same signature the Lobby uses for its own buttons),
// so this component stays unaware of useWebRTC.

import { useMemo, useState } from 'react';
import { useMeetings, type ScheduledMeeting } from '../hooks/useMeetings';

interface Props {
  onJoin: (roomId: string, inviteToken?: string) => void;
}

export function MeetingsDashboard({ onJoin }: Props) {
  const {
    meetings,
    loading,
    error,
    createMeeting,
    cancelMeeting,
    canJoinNow,
    refresh,
  } = useMeetings();

  // Inline-form state.
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  // Defaults: 15 minutes from now, 30-minute meeting. Stored as datetime-local
  // string (browser-formatted) so the <input type="datetime-local"> binds cleanly.
  const [whenLocal, setWhenLocal] = useState(() =>
    toLocalDatetime(new Date(Date.now() + 15 * 60 * 1000))
  );
  const [duration, setDuration] = useState(30);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Split upcoming vs in-progress for nicer grouping; cancelled go last.
  const grouped = useMemo(() => groupMeetings(meetings, canJoinNow), [
    meetings,
    canJoinNow,
  ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const when = parseLocalDatetime(whenLocal);
    if (!when || isNaN(when.getTime())) {
      setFeedback('Pick a valid date/time.');
      return;
    }
    const result = await createMeeting({
      title: title.trim(),
      scheduledFor: when,
      durationMinutes: duration,
    });
    if (!result) return;

    // Build a shareable link. We use the room id + token in the hash so
    // an existing route like #/room/<id>?invite=<token> would work; for
    // now we copy the token alone (Lobby's "I have an invite code" UI is
    // what the recipient pastes into).
    const link = buildInviteLink(result.meeting.roomId, result.inviteToken);
    try {
      await navigator.clipboard.writeText(link);
      setFeedback('Invite link copied to clipboard');
    } catch {
      setFeedback(`Invite token: ${result.inviteToken}`);
    }
    setTimeout(() => setFeedback(null), 6000);

    // Reset the form for the next meeting.
    setTitle('');
    setCreating(false);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Your meetings
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => void refresh()}
            className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
            title="Reload"
          >
            ↻
          </button>
          <button
            onClick={() => setCreating((c) => !c)}
            className="rounded bg-brand-500 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-600"
          >
            {creating ? 'Cancel' : '+ Schedule'}
          </button>
        </div>
      </div>

      {creating && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title"
            className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-brand-500"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="datetime-local"
              value={whenLocal}
              onChange={(e) => setWhenLocal(e.target.value)}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <select
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value, 10))}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm outline-none focus:border-brand-500"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Schedule + copy invite link
          </button>
        </form>
      )}

      {feedback && (
        <p className="mt-2 rounded-md border border-emerald-800/40 bg-emerald-900/20 p-2 text-center text-xs text-emerald-200">
          {feedback}
        </p>
      )}

      {error && (
        <p className="mt-2 text-center text-xs text-red-400">{error}</p>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {loading && meetings.length === 0 && (
          <p className="text-center text-xs text-slate-500">Loading…</p>
        )}

        {!loading && meetings.length === 0 && !creating && (
          <p className="text-center text-xs text-slate-500">
            No upcoming meetings. Schedule one to see it here.
          </p>
        )}

        {grouped.live.length > 0 && (
          <Section title="Happening now">
            {grouped.live.map((m) => (
              <MeetingRow
                key={m.id}
                m={m}
                canJoin
                onJoin={onJoin}
                onCancel={cancelMeeting}
              />
            ))}
          </Section>
        )}
        {grouped.upcoming.length > 0 && (
          <Section title="Upcoming">
            {grouped.upcoming.map((m) => (
              <MeetingRow
                key={m.id}
                m={m}
                canJoin={false}
                onJoin={onJoin}
                onCancel={cancelMeeting}
              />
            ))}
          </Section>
        )}
        {grouped.past.length > 0 && (
          <Section title="Recent">
            {grouped.past.map((m) => (
              <MeetingRow
                key={m.id}
                m={m}
                canJoin={false}
                past
                onJoin={onJoin}
                onCancel={cancelMeeting}
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

// --- Subcomponents --------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
        {title}
      </p>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  );
}

function MeetingRow({
  m,
  canJoin,
  past,
  onJoin,
  onCancel,
}: {
  m: ScheduledMeeting;
  canJoin: boolean;
  past?: boolean;
  onJoin: (roomId: string, inviteToken?: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md bg-slate-800/40 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-sm ${
            m.cancelled
              ? 'text-slate-500 line-through'
              : past
                ? 'text-slate-400'
                : 'text-slate-200'
          }`}
        >
          {m.title}
        </p>
        <p className="text-[10px] text-slate-500">
          {formatWhen(m.scheduledFor)} · {m.durationMinutes} min · room{' '}
          <span className="font-mono">{m.roomId}</span>
        </p>
      </div>
      {!m.cancelled && !past && (
        <button
          onClick={() => onJoin(m.roomId)}
          disabled={!canJoin}
          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          title={canJoin ? 'Open the room' : 'Join opens 5 min before start'}
        >
          Join
        </button>
      )}
      {!m.cancelled && !past && (
        <button
          onClick={() => onCancel(m.id)}
          className="rounded bg-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-600"
          title="Cancel this meeting"
        >
          ×
        </button>
      )}
    </li>
  );
}

// --- Helpers --------------------------------------------------------------

interface Grouped {
  live: ScheduledMeeting[];
  upcoming: ScheduledMeeting[];
  past: ScheduledMeeting[];
}

function groupMeetings(
  list: ScheduledMeeting[],
  canJoinNow: (m: ScheduledMeeting) => boolean
): Grouped {
  const now = Date.now();
  const live: ScheduledMeeting[] = [];
  const upcoming: ScheduledMeeting[] = [];
  const past: ScheduledMeeting[] = [];
  for (const m of list) {
    if (canJoinNow(m)) live.push(m);
    else if (m.scheduledFor > now) upcoming.push(m);
    else past.push(m);
  }
  return { live, upcoming, past };
}

// Format `<input type="datetime-local">` value (YYYY-MM-DDTHH:mm in
// local time) from a Date. The input does NOT accept timezone suffixes.
function toLocalDatetime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function parseLocalDatetime(s: string): Date | null {
  if (!s) return null;
  // The string is local-time without an offset; Date() interprets it
  // as local-time on construction, which is what we want.
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatWhen(epochMs: number): string {
  const d = new Date(epochMs);
  // Intl avoids hand-rolling tz logic and respects the user's locale.
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

// We don't ship a routed invite URL yet — the lobby's "I have an invite
// code" flow is what guests use. So the link is currently the bare token,
// which the recipient pastes into that field. When you add a real
// router, replace this with `${origin}/#/room/${roomId}?invite=${token}`.
function buildInviteLink(_roomId: string, token: string): string {
  return token;
}
