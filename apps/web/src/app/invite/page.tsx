'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  requestMeetingAdmission,
  getAdmissionStatus,
  type AdmissionStatus,
} from '@/lib/meetings-api';

function InviteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState('Checking your invitation…');
  const [request, setRequest] = useState<AdmissionStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('This invitation link is missing its token.');
      setLoading(false);
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    const startAdmission = async () => {
      try {
        const { data, error: authError } = await supabase.auth.getSession();

        if (authError || !data.session) {
          throw new Error('Please sign in to ConnectCall first, then reopen this invitation link.');
        }

        const displayName =
          data.session.user.user_metadata?.display_name ||
          data.session.user.email?.split('@')[0] ||
          'Guest';

        const result = await requestMeetingAdmission(token, displayName);

        if (!active) return;

        const initial: AdmissionStatus = {
          requestId: result.request_id,
          status: result.request_status,
          roomCode: result.room_code,
          meetingTitle: result.meeting_title,
        };

        setRequest(initial);
        setLoading(false);

        if (initial.status === 'admitted') {
          router.replace(`/?room=${encodeURIComponent(initial.roomCode)}&approved=1`);
          return;
        }

        if (initial.status === 'rejected') {
          setStatus('The host declined your request.');
          return;
        }

        setStatus('Your request has been sent. Waiting for the host to admit you…');

        timer = setInterval(async () => {
          try {
            const latest = await getAdmissionStatus(initial.requestId);
            if (!active) return;

            setRequest(latest);

            if (latest.status === 'admitted') {
              if (timer) clearInterval(timer);
              setStatus('Approved! Joining your meeting…');
              router.replace(`/?room=${encodeURIComponent(latest.roomCode)}&approved=1`);
            } else if (latest.status === 'rejected') {
              if (timer) clearInterval(timer);
              setStatus('The host declined your request.');
            }
          } catch (pollError) {
            console.error('Admission status check failed:', pollError);
          }
        }, 2500);
      } catch (e) {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Could not process this invitation.');
        setLoading(false);
      }
    };

    void startAdmission();

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [token, router]);

  return (
    <main style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: '#10100f',
      color: '#f4f0e8',
      padding: 24,
      fontFamily: 'Arial, sans-serif',
    }}>
      <section style={{
        width: '100%',
        maxWidth: 440,
        padding: 32,
        border: '1px solid #39352d',
        borderRadius: 18,
        background: '#191815',
        textAlign: 'center',
      }}>
        <p style={{ color: '#d6a64d', letterSpacing: 3, fontSize: 12 }}>
          CONNECTCALL
        </p>

        <h1 style={{ fontSize: 27, margin: '20px 0 12px' }}>
          {error ? 'Invitation unavailable' : 'Meeting invitation'}
        </h1>

        {loading ? (
          <p style={{ color: '#aaa' }}>Verifying your invitation…</p>
        ) : error ? (
          <>
            <p style={{ color: '#e6a09a', lineHeight: 1.6 }}>{error}</p>
            <a href="/" style={{ color: '#d6a64d' }}>Go to ConnectCall</a>
          </>
        ) : (
          <>
            <p style={{ color: '#d6a64d', fontSize: 16, margin: '20px 0 8px' }}>
              {request?.meetingTitle}
            </p>
            <p style={{ color: '#b9b4aa', lineHeight: 1.7 }}>{status}</p>
            {request?.status === 'pending' && (
              <div style={{
                width: 30,
                height: 30,
                border: '3px solid #514b3e',
                borderTopColor: '#d6a64d',
                borderRadius: '50%',
                margin: '24px auto 0',
                animation: 'connectcall-spin 1s linear infinite',
              }} />
            )}
            {request?.status === 'rejected' && (
              <a href="/" style={{ color: '#d6a64d' }}>Return to ConnectCall</a>
            )}
          </>
        )}
        <style>{`
          @keyframes connectcall-spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </section>
    </main>
  );
}


export default function InvitePage() {
  return (
    <Suspense fallback={
      <main style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#10100f',
        color: '#f4f0e8',
      }}>
        Loading invitation…
      </main>
    }>
      <InviteContent />
    </Suspense>
  );
}
