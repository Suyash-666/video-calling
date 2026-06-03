// components/AnalyticsDashboard.tsx
//
// Lobby panel showing the host's meeting analytics:
//   - Four stat tiles (calls, total hours, messages, participant-hours)
//   - Bar chart: meetings per day (last 14 days)
//   - Line chart: average duration per day (minutes)
//   - Compact list of the most-recent sessions
//
// Data + derivations come from useAnalytics. Pure presentational.
// Re-styled: stat tiles are typographic figures rather than
// colored cards, charts use the single accent color, no shadows.

import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAnalytics, type CallSession } from '../hooks/useAnalytics';
import { MigrationHint } from './MigrationHint';
import { ChevronDownIcon, RefreshIcon } from './Icons';

// Chart colors. We use a single accent and a desaturated ink
// value for the grid, mirroring the rest of the design system.
const ACCENT = '#E8C47A';
const GRID = 'rgba(255,255,255,0.04)';
const AXIS = '#71717A';

export function AnalyticsDashboard() {
  const { sessions, totals, byDay, loading, error, schemaMissing, refresh } =
    useAnalytics();
  const [open, setOpen] = useState(true);

  // Headline numbers, formatted for display.
  const totalHours = (totals.totalSeconds / 3600).toFixed(1);
  const participantHours = (totals.totalParticipantSeconds / 3600).toFixed(1);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen((o) => !o)}
          className="micro-label flex items-center gap-2 outline-none
                     transition-colors duration-180 ease-out
                     hover:text-ink-200"
          aria-expanded={open}
        >
          <ChevronDownIcon
            size={12}
            className={`transition-transform duration-180 ease-out
                        ${open ? '' : '-rotate-90'}`}
          />
          Meeting analytics
        </button>
        <div className="flex items-center gap-6 text-small">
          <span className="font-mono text-ink-500">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => void refresh()}
            className="action-secondary inline-flex items-center gap-2"
            title="Reload"
          >
            <RefreshIcon size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-small text-state-error">{error}</p>}

      {open && (
        <>
          {schemaMissing ? (
            <MigrationHint
              migration="0009_meeting_analytics.sql"
              feature="Meeting analytics"
            />
          ) : loading && sessions.length === 0 ? (
            <p className="py-12 text-center text-small text-ink-500">
              Loading…
            </p>
          ) : sessions.length === 0 ? (
            <p className="py-12 text-center text-small text-ink-500">
              No call sessions yet. Host a meeting and analytics will
              appear here when it ends.
            </p>
          ) : (
            <div className="flex flex-col gap-8">
              {/* Stat tiles. No card chrome — just micro-label +
                  figure. The four figures are aligned in a 4-col
                  grid with generous gap. */}
              <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
                <Stat label="Calls" value={String(totals.callCount)} />
                <Stat label="Hours" value={totalHours} />
                <Stat
                  label="Messages"
                  value={String(totals.totalMessages)}
                />
                <Stat
                  label="Participant-hrs"
                  value={participantHours}
                  hint="peak participants × duration"
                />
              </div>

              <Chart title="Meetings per day (last 14 days)">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart
                    data={byDay}
                    margin={{ top: 6, right: 6, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis
                      dataKey="label"
                      stroke={AXIS}
                      style={{ fontSize: 10 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke={AXIS}
                      style={{ fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: '#E4E4E7' }}
                      cursor={{ fill: 'rgba(232,196,122,0.06)' }}
                    />
                    <Bar dataKey="callCount" fill={ACCENT} radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Chart>

              <Chart title="Average duration per day (min)">
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart
                    data={byDay}
                    margin={{ top: 6, right: 6, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis
                      dataKey="label"
                      stroke={AXIS}
                      style={{ fontSize: 10 }}
                    />
                    <YAxis stroke={AXIS} style={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: '#E4E4E7' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgDurationMin"
                      stroke={ACCENT}
                      strokeWidth={1.5}
                      dot={{ r: 2, fill: ACCENT, stroke: 'none' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Chart>

              <RecentSessions sessions={sessions.slice(0, 5)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Subcomponents --------------------------------------------------------

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <p className="micro-label">{label}</p>
      <p className="mt-2 font-mono text-display-sm text-ink-50">
        {value}
      </p>
    </div>
  );
}

function Chart({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="micro-label mb-4">{title}</p>
      {children}
    </div>
  );
}

function RecentSessions({ sessions }: { sessions: CallSession[] }) {
  return (
    <div>
      <p className="micro-label mb-4">Recent sessions</p>
      <ul className="flex flex-col">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="row"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-body text-ink-200">
                Room{' '}
                <span className="font-mono text-ink-50">{s.roomId}</span>
              </p>
              <p className="mt-1 text-micro uppercase
                          tracking-[0.12em] text-ink-500">
                {new Date(s.startedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-6 font-mono
                            text-small text-ink-400">
              <span title="Duration">
                {formatDuration(s.durationSeconds)}
              </span>
              <span title="Peak participants">
                <span className="text-ink-200">{s.peakParticipants}</span>
                <span className="text-ink-500">&nbsp;ppl</span>
              </span>
              <span title="Messages">
                <span className="text-ink-200">{s.messageCount}</span>
                <span className="text-ink-500">&nbsp;msgs</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Helpers --------------------------------------------------------------

const tooltipStyle: React.CSSProperties = {
  backgroundColor: '#111114',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  fontSize: 11,
  color: '#E4E4E7',
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}
