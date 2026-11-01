import { supabase } from '@/lib/supabase';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error('Please sign in first.');
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
      ...options.headers,
    },
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || result.error || 'Request failed.');
  }

  return result as T;
}

export type MeetingInvite = {
  inviteId: string;
  token: string;
  expiresAt: string;
  maxUses: number;
};

export type AdmissionRequest = {
  request_id: string;
  meeting_id: string;
  request_status: 'pending' | 'admitted' | 'rejected';
  room_code: string;
  meeting_title: string;
};

export type WaitingRequest = {
  id: string;
  guest_id: string;
  guest_name: string;
  status: 'pending';
  created_at: string;
};

export function createMeetingInvite(
  meetingId: string,
  expiresInHours = 24,
  maxUses = 10,
) {
  return apiRequest<MeetingInvite>(
    `/meetings/${encodeURIComponent(meetingId)}/invites`,
    {
      method: 'POST',
      body: JSON.stringify({ expiresInHours, maxUses }),
    },
  );
}

export function requestMeetingAdmission(token: string, name: string) {
  return apiRequest<AdmissionRequest>('/meetings/admission', {
    method: 'POST',
    body: JSON.stringify({ token, name }),
  });
}

export function getWaitingRequests(meetingId: string) {
  return apiRequest<WaitingRequest[]>(
    `/meetings/${encodeURIComponent(meetingId)}/waiting-room`,
  );
}

export function reviewWaitingRequest(
  requestId: string,
  status: 'admitted' | 'rejected',
) {
  return apiRequest<WaitingRequest>(
    `/meetings/waiting-room/${encodeURIComponent(requestId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  );
}

export type AdmissionStatus = {
  requestId: string;
  status: 'pending' | 'admitted' | 'rejected';
  roomCode: string;
  meetingTitle: string;
};

export function getAdmissionStatus(requestId: string) {
  return apiRequest<AdmissionStatus>(
    `/meetings/admission/${encodeURIComponent(requestId)}`,
  );
}


export function revokeMeetingInvite(inviteId: string) {
  return apiRequest<{ success: boolean; message: string }>(
    `/meetings/invites/${encodeURIComponent(inviteId)}/revoke`,
    { method: 'PATCH' },
  );
}
