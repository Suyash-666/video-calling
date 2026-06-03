// hooks/useAnalytics.ts
// Lobby-side dashboard data source: pulls every call session the
// current user hosted, derives a few headline numbers, and feeds the
// charts. Lightweight — one SELECT, no realtime, no streaming.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

export interface CallSession {
  id: string;
  roomId: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  peakParticipants: number;
  messageCount: number;
}

export interface AnalyticsTotals {
  callCount: number;
  totalSeconds: number;
  totalMessages: number;
  totalParticipantSeconds: number; // sum across all calls (peak * duration)
}

export interface DayBucket {
  // ISO date (YYYY-MM-DD) in the local timezone.
  date: string;
  // Pretty label for the X axis ("Mon", "Tue", …).
  label: string;
  callCount: number;
  avgDurationMin: number;
}

export interface UseAnalyticsResult {
  sessions: CallSession[];
  totals: AnalyticsTotals;
  byDay: DayBucket[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

// How many days of history we visualize in the bar/line chart. Anything
// older still counts toward `totals` but is grouped into "older".
const CHART_DAYS = 14;

function rowToSession(r: any): CallSession {
  return {
    id: r.id,
    roomId: r.room_id,
    startedAt: new Date(r.started_at).getTime(),
    endedAt: new Date(r.ended_at).getTime(),
    durationSeconds: r.duration_seconds,
    peakParticipants: r.peak_participants,
    messageCount: r.message_count,
  };
}

// Format the local-tz YYYY-MM-DD for a Date.
function localDateKey(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function useAnalytics(): UseAnalyticsResult {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<CallSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setSessions([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('call_sessions')
        .select(
          'id, room_id, started_at, ended_at, duration_seconds, peak_participants, message_count'
        )
        .order('started_at', { ascending: false })
        // Cap at a generous limit so we don't pull thousands of rows
        // into the lobby. Replace with pagination if you ever need it.
        .limit(500);
      if (err) {
        setError(err.message);
        return;
      }
      setSessions((data ?? []).map(rowToSession));
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Derived numbers + chart buckets. Memoized so the chart components
  // don't re-render when unrelated state changes upstream.
  const { totals, byDay } = useMemo(() => {
    const t: AnalyticsTotals = {
      callCount: sessions.length,
      totalSeconds: 0,
      totalMessages: 0,
      totalParticipantSeconds: 0,
    };
    for (const s of sessions) {
      t.totalSeconds += s.durationSeconds;
      t.totalMessages += s.messageCount;
      t.totalParticipantSeconds += s.durationSeconds * s.peakParticipants;
    }

    // Build CHART_DAYS daily buckets ending today (inclusive).
    const buckets = new Map<string, { count: number; durSum: number }>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      buckets.set(localDateKey(d), { count: 0, durSum: 0 });
    }
    for (const s of sessions) {
      const key = localDateKey(new Date(s.startedAt));
      const b = buckets.get(key);
      if (!b) continue; // outside window
      b.count += 1;
      b.durSum += s.durationSeconds;
    }
    const days: DayBucket[] = Array.from(buckets.entries()).map(([date, b]) => {
      const d = new Date(date + 'T00:00:00');
      return {
        date,
        // Short weekday for the X-axis tick. Friendly without being verbose.
        label: d.toLocaleDateString(undefined, { weekday: 'short' }),
        callCount: b.count,
        avgDurationMin:
          b.count > 0 ? Math.round((b.durSum / b.count / 60) * 10) / 10 : 0,
      };
    });

    return { totals: t, byDay: days };
  }, [sessions]);

  return { sessions, totals, byDay, loading, error, refresh };
}
