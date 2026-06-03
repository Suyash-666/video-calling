// hooks/useMeetings.ts
// Scheduled meetings: list, create (with optional pre-minted invite),
// cancel, and a `canJoinNow()` predicate the dashboard uses to enable
// the "Join" button when start-time-minus-five-minutes has arrived.
//
// Why a separate hook from useWebRTC:
//   - The dashboard lives in the lobby; the call hook only matters in-room.
//   - Loading meetings should not block joining a call, and vice versa.
//   - This hook owns just a SELECT + two RPCs; mixing it into useWebRTC
//     would bloat that file with concerns that don't share state.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

// Mirrors public.scheduled_meetings + a derived `cancelled` boolean.
export interface ScheduledMeeting {
  id: string;
  roomId: string;
  title: string;
  scheduledFor: number; // epoch ms
  durationMinutes: number;
  createdAt: number;
  cancelled: boolean;
}

// How early before scheduled_for the Join button unlocks. Matches what
// Google Meet / Zoom do — gives the host time to set up.
const JOIN_WINDOW_LEAD_MS = 5 * 60 * 1000;

export interface UseMeetingsResult {
  meetings: ScheduledMeeting[];
  loading: boolean;
  error: string | null;
  // Create a meeting and pre-mint a long-lived invite. Returns the new
  // meeting row plus the invite token (paste-into-calendar friendly).
  createMeeting: (input: {
    title: string;
    scheduledFor: Date;
    durationMinutes?: number;
  }) => Promise<{
    meeting: ScheduledMeeting;
    inviteToken: string;
    inviteExpiresAt: number;
  } | null>;
  cancelMeeting: (id: string) => Promise<void>;
  // True when the meeting's join window has opened (and the meeting
  // isn't cancelled / long over).
  canJoinNow: (m: ScheduledMeeting) => boolean;
  // Manual refresh — useful after the user creates one in another tab.
  refresh: () => Promise<void>;
}

function rowToMeeting(r: any): ScheduledMeeting {
  return {
    id: r.id,
    roomId: r.room_id,
    title: r.title,
    scheduledFor: new Date(r.scheduled_for).getTime(),
    durationMinutes: r.duration_minutes,
    createdAt: new Date(r.created_at).getTime(),
    cancelled: !!r.cancelled_at,
  };
}

export function useMeetings(): UseMeetingsResult {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<ScheduledMeeting[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A "now" tick state we bump every 30s so canJoinNow re-evaluates and
  // the Join button enables on time without the user clicking refresh.
  const [, setNowTick] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setMeetings([]);
      return;
    }
    setLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('scheduled_meetings')
        .select(
          'id, room_id, title, scheduled_for, duration_minutes, created_at, cancelled_at'
        )
        // Show recent + upcoming; hide meetings >24h in the past so the
        // dashboard stays small without server-side pagination.
        .gte(
          'scheduled_for',
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        )
        .order('scheduled_for', { ascending: true });
      if (err) {
        setError(err.message);
        return;
      }
      setMeetings((data ?? []).map(rowToMeeting));
      setError(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Initial load + reload when the user changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tick every 30s so canJoinNow flips at the right moment.
  useEffect(() => {
    const t = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const createMeeting = useCallback<UseMeetingsResult['createMeeting']>(
    async ({ title, scheduledFor, durationMinutes }) => {
      if (!user) {
        setError('You must be signed in to schedule a meeting.');
        return null;
      }
      // The single-call RPC schedules, creates the room shell, and mints
      // a long-lived invite all in one transaction.
      const { data, error: err } = await supabase.rpc(
        'create_meeting_with_invite',
        {
          p_title: title,
          p_scheduled_for: scheduledFor.toISOString(),
          p_duration_minutes: durationMinutes ?? 30,
        }
      );
      if (err || !data || !data.length) {
        setError(`Could not create meeting: ${err?.message ?? 'unknown'}`);
        return null;
      }
      const row: any = data[0];
      // Re-select the meeting row so the list shape stays consistent.
      const { data: mtgRow } = await supabase
        .from('scheduled_meetings')
        .select(
          'id, room_id, title, scheduled_for, duration_minutes, created_at, cancelled_at'
        )
        .eq('id', row.meeting_id)
        .single();
      const meeting = rowToMeeting(mtgRow);
      setMeetings((prev) =>
        [...prev, meeting].sort((a, b) => a.scheduledFor - b.scheduledFor)
      );
      return {
        meeting,
        inviteToken: row.invite_token,
        inviteExpiresAt: new Date(row.expires_at).getTime(),
      };
    },
    [user]
  );

  const cancelMeeting = useCallback(async (id: string) => {
    const { error: err } = await supabase.rpc('cancel_scheduled_meeting', {
      p_id: id,
    });
    if (err) {
      setError(`Could not cancel: ${err.message}`);
      return;
    }
    setMeetings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, cancelled: true } : m))
    );
  }, []);

  const canJoinNow = useCallback((m: ScheduledMeeting): boolean => {
    if (m.cancelled) return false;
    const now = Date.now();
    const opensAt = m.scheduledFor - JOIN_WINDOW_LEAD_MS;
    const closesAt = m.scheduledFor + m.durationMinutes * 60 * 1000;
    return now >= opensAt && now <= closesAt;
  }, []);

  return useMemo(
    () => ({
      meetings,
      loading,
      error,
      createMeeting,
      cancelMeeting,
      canJoinNow,
      refresh,
    }),
    [meetings, loading, error, createMeeting, cancelMeeting, canJoinNow, refresh]
  );
}
