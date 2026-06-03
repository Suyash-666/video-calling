// components/MeetingsDashboard.tsx
//
// Lobby-side panel: list of upcoming + recent scheduled meetings,
// inline form to schedule a new one, cancel, and a "Join" link that
// enables only inside the meeting's join window.
//
// Re-styled to match the new design system. The dashboard is no
// longer a card of rows; it's a hairline-divided list with aligned
// columns (TIME · DURATION · ROOM) and right-aligned actions. The
// create form is inline but visually distinct from the list
// itself.

import { useMemo, useState } from 'react';
import { useMeetings, type ScheduledMeeting } from '../hooks/useMeetings';
import { MigrationHint } from './MigrationHint';
import { buildInviteLink } from '../lib/inviteLink';
import {
  ArrowRightIcon,
  CloseIcon,
  PlusIcon,
  RefreshIcon,
} from './Icons';

interface Props {
  onJoin: (roomId: string, inviteToken?: string) => void;
}

export function MeetingsDashboard({ onJoin }: Props) {
  const {
    meetings,
    loading,
    error,
    schemaMissing,
    createMeeting,
    cancelMeeting,
    canJoinNow,
    refresh,
  } = useMeetings();

  // Inline-form state.
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  // Defaults: 15 minutes from now, 30-minute meeting. Stored as
  // datetime-local string (browser-formatted) so the <input
  // type="datetime-local"> binds cleanly.
  const [whenLocal, setWhenLocal] = useState(() =>
    toLocalDatetime(new Date(Date.now() + 15 * 60 * 1000))
  );
  const [duration, setDuration] = useState(30);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Split upcoming vs in-progress for nicer grouping; cancelled go
  // last.
  const grouped = useMemo(
    () => groupMeetings(meetings, canJoinNow),
    [meetings, canJoinNow]
  );

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

    const link = buildInviteLink(result.meeting.roomId, result.inviteToken);
    try {
      await navigator.clipboard.writeText(link);
      setFeedback('Invite link copied to clipboard.');
    } catch {
      setFeedback(`Invite link: ${link}`);
    }
    setTimeout(() => setFeedback(null), 6000);

    setTitle('');
    setCreating(false);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Header row. The micro-label on the left, action links on
          the right. No card around it. */}
      <div className="flex items-center justify-between">
        <p className="micro-label">SCHEDULED MEETINGS</p>
        <div className="flex items-center gap-6 text-small">
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="action-secondary inline-flex items-center gap-2"
            title="Reload"
          >
            <RefreshIcon size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={() => setCreating((c) => !c)}
            disabled={schemaMissing}
            className="action-primary inline-flex items-center gap-2"
            title={schemaMissing ? 'Apply the 0008 migration first' : undefined}
          >
            <PlusIcon size={14} />
            {creating ? 'Close' : 'Schedule'}
          </button>
        </div>
      </div>

      {/* Inline create form. The two small fields sit on a single
          row at md+ widths, stack on mobile. Submit is a text
          link with underline, consistent with the rest of the
          app. */}
      {creating && (
        <form onSubmit={submit} className="flex flex-col gap-6">
          <label className="block">
            <span className="micro-label">TITLE</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Quarterly review"
              className="input-bare mt-2"
              autoFocus
            />
          </label>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <label className="block">
              <span className="micro-label">STARTS</span>
              <input
                type="datetime-local"
                value={whenLocal}
                onChange={(e) => setWhenLocal(e.target.value)}
                className="input-bare-sm mt-2 w-full"
              />
            </label>
            <label className="block">
              <span className="micro-label">DURATION</span>
              <select
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value, 10))}
                className="input-bare-sm mt-2 w-full cursor-pointer
                           appearance-none bg-transparent pr-6"
              >
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m} className="bg-surface">
                    {m} min
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-6">
            <button type="submit" className="action-primary">
              Schedule + copy invite link
              <ArrowRightIcon size={14} className="opacity-60" />
            </button>
          </div>
        </form>
      )}

      {feedback && (
        <p className="text-small text-state-success">{feedback}</p>
      )}

      {error && <p className="text-small text-state-error">{error}</p>}

      {schemaMissing && (
        <MigrationHint
          migration="0008_scheduled_meetings.sql"
          feature="Scheduled meetings"
        />
      )}

      {/* List. Three sections: live (amber dot), upcoming, past.
          Each row uses the .row utility from index.css. */}
      <div className="flex flex-col">
        {!schemaMissing && loading && meetings.length === 0 && (
          <p className="py-12 text-center text-small text-ink-500">
            Loading…
          </p>
        )}

        {!schemaMissing && !loading && meetings.length === 0 && !creating && (
          <p className="py-12 text-center text-small text-ink-500">
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
      <p className="micro-label py-4">{title}</p>
      <ul className="flex flex-col">{children}</ul>
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
  onCancel: (id: string) => Promise<void>;
}) {
  return (
    <li className="row">
      {/* Left: live dot when canJoin. Otherwise a small dim dot to
          keep the row's left edge aligned. */}
      <div className="w-3 shrink-0">
        {canJoin ? (
          <span className="live-dot" />
        ) : (
          <span className="block h-1.5 w-1.5 rounded-full bg-ink-700" />
        )}
      </div>

      {/* Title + when. Title is the dominant line, the when
          renders below in micro type. */}
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-body ${
            m.cancelled
              ? 'text-ink-500 line-through'
              : past
                ? 'text-ink-400'
                : 'text-ink-50'
          }`}
        >
          {m.title}
        </p>
        <p className="mt-1 text-micro uppercase tracking-[0.12em]
                     text-ink-500">
          {formatWhen(m.scheduledFor)}
        </p>
      </div>

      {/* Aligned numeric columns. Duration in minutes, room id in
          mono. Both tabular-nums via the global rule. */}
      <div className="hidden w-24 shrink-0 text-right font-mono
                      text-small text-ink-400 sm:block">
        {m.durationMinutes}&nbsp;min
      </div>
      <div className="hidden w-40 shrink-0 truncate text-right
                      font-mono text-small text-ink-500
                      lg:block">
        {m.roomId}
      </div>

      {/* Right-aligned actions. Join is the primary action (text
          link with underline) and only renders when the meeting
          is cancellable (not past, not cancelled). Cancel is a
          secondary icon-only button. */}
      <div className="flex shrink-0 items-center gap-6">
        {!m.cancelled && !past && (
          <button
            onClick={() => onJoin(m.roomId)}
            disabled={!canJoin}
            aria-disabled={!canJoin}
            className="action-primary"
            title={canJoin ? 'Open the room' : 'Opens 5 min before start'}
          >
            Join
            <ArrowRightIcon size={14} className="opacity-60" />
          </button>
        )}
        {!m.cancelled && !past && (
          <button
            onClick={() => onCancel(m.id)}
            className="text-ink-500 outline-none
                       transition-colors duration-180 ease-out
                       hover:text-ink-200"
            title="Cancel this meeting"
            aria-label="Cancel meeting"
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>
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

function toLocalDatetime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function parseLocalDatetime(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatWhen(epochMs: number): string {
  const d = new Date(epochMs);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}
