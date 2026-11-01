'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getWaitingRequests,
  reviewWaitingRequest,
  type WaitingRequest,
} from '@/lib/meetings-api';

export default function WaitingRoomPanel({ meetingId }: { meetingId: string }) {
  const [requests, setRequests] = useState<WaitingRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const latest = await getWaitingRequests(meetingId);
      setRequests(latest);
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load requests.');
    }
  }, [meetingId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const review = async (id: string, status: 'admitted' | 'rejected') => {
    setBusy(id);
    try {
      await reviewWaitingRequest(id, status);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not review request.');
    } finally {
      setBusy(null);
    }
  };

  if (requests.length === 0 && !notice) return null;

  return (
    <section style={{
      position: 'fixed',
      right: 20,
      bottom: 20,
      zIndex: 100,
      width: 'min(350px, calc(100vw - 40px))',
      maxHeight: '45vh',
      overflowY: 'auto',
      padding: 18,
      border: '1px solid #514632',
      borderRadius: 14,
      background: '#191815',
      color: '#f4f0e8',
      boxShadow: '0 12px 40px #0009',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <strong>Waiting room</strong>
        <span style={{ color: '#d6a64d' }}>{requests.length} pending</span>
      </div>

      {notice && <p style={{ color: '#e6a09a', fontSize: 12 }}>{notice}</p>}

      {requests.map((request) => (
        <div key={request.id} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          paddingTop: 14,
          marginTop: 12,
          borderTop: '1px solid #39352d',
        }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {request.guest_name}
            </strong>
            <small style={{ color: '#aaa' }}>Wants to join</small>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              disabled={busy === request.id}
              onClick={() => void review(request.id, 'admitted')}
              style={{ background: '#d6a64d', color: '#17140e', border: 0, borderRadius: 7, padding: '7px 10px', cursor: 'pointer' }}
            >
              Admit
            </button>
            <button
              disabled={busy === request.id}
              onClick={() => void review(request.id, 'rejected')}
              style={{ background: '#39352d', color: '#f4f0e8', border: 0, borderRadius: 7, padding: '7px 10px', cursor: 'pointer' }}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
