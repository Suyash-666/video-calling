// components/AnalyticsDashboard.tsx
// Lobby panel showing the host's meeting analytics:
//   - Four stat tiles (calls, total hours, messages, participant-hours)
//   - Bar chart: meetings per day (last 14 days)
//   - Line chart: average duration per day (minutes)
//   - Compact list of the most-recent sessions
//
// Data + derivations come from useAnalytics. Pure presentational.

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

export function AnalyticsDashboard() {
  const { sessions, totals, byDay, loading, error, refresh } = useAnalytics();
  const [open, setOpen] = useState(true);

  // Headline numbers, formatted for display.
  const totalHours = (totals.totalSeconds / 3600).toFixed(1);
  const participantHours = (totals.totalParticipantSeconds / 3600).toFixed(1);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-300"
          aria-expanded={open}
        >
          <span>{open ? '▾' : '▸'}</span>
          Meeting analytics
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => void refresh()}
            className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
            title="Reload"
          >
            ↻
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-2 text-center text-xs text-red-400">{error}</p>
      )}

      {open && (
        <>
          {loading && sessions.length === 0 ? (
            <p className="mt-3 text-center text-xs text-slate-500">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="mt-3 text-center text-xs text-slate-500">
              No call sessions yet. Host a meeting and analytics will appear
              here when it ends.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-4">
              {/* Stat tiles */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Calls" value={String(totals.callCount)} />
                <StatTile label="Hours" value={totalHours} />
                <StatTile
                  label="Messages"
                  value={String(totals.totalMessages)}
                />
                <StatTile
                  label="Participant-hrs"
                  value={participantHours}
                  hint="peak participants × duration"
                />
              </div>

              {/* Bar: meetings per day */}
              <ChartCard title="Meetings per day (last 14 days)">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart
                    data={byDay}
                    margin={{ top: 6, right: 6, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="label"
                      stroke="#64748b"
                      style={{ fontSize: 10 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="#64748b"
                      style={{ fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: '#cbd5e1' }}
                      cursor={{ fill: 'rgba(99,102,241,0.1)' }}
                    />
                    <Bar dataKey="callCount" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Line: avg duration per day */}
              <ChartCard title="Average duration per day (min)">
                <ResponsiveContainer width="100%" height={140}>
                  <LineChart
                    data={byDay}
                    margin={{ top: 6, right: 6, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="label"
                      stroke="#64748b"
                      style={{ fontSize: 10 }}
                    />
                    <YAxis stroke="#64748b" style={{ fontSize: 10 }} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: '#cbd5e1' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgDurationMin"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 2, fill: '#10b981' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Recent list */}
              <RecentSessions sessions={sessions.slice(0, 5)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Subcomponents --------------------------------------------------------

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div
      className="rounded-lg bg-slate-800/60 px-3 py-2"
      title={hint}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-100">
        {value}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-slate-800/40 p-2">
      <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
        {title}
      </p>
      {children}
    </div>
  );
}

function RecentSessions({ sessions }: { sessions: CallSession[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
        Recent sessions
      </p>
      <ul className="flex flex-col gap-1">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex items-center justify-between gap-2 rounded-md bg-slate-800/40 px-3 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate text-xs text-slate-200">
                Room <span className="font-mono">{s.roomId}</span>
              </p>
              <p className="text-[10px] text-slate-500">
                {new Date(s.startedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[11px] text-slate-400">
              <span title="Duration">
                ⏱ {formatDuration(s.durationSeconds)}
              </span>
              <span title="Peak participants">
                👥 {s.peakParticipants}
              </span>
              <span title="Messages">💬 {s.messageCount}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Helpers --------------------------------------------------------------

const tooltipStyle: React.CSSProperties = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 6,
  fontSize: 11,
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}
