import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SupabaseService } from './supabase.service.js';

@Injectable()
export class MeetingsService {
  constructor(private readonly supabase: SupabaseService) {}

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private async requireOwner(meetingId: string, userId: string) {
    const { data, error } = await this.supabase.client
      .from('meetings')
      .select('id, host_id, room_code, title')
      .eq('id', meetingId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Meeting not found');
    if (data.host_id !== userId) {
      throw new ForbiddenException('Only the meeting host can perform this action');
    }

    return data;
  }

  async createInvite(
    meetingId: string,
    userId: string,
    expiresInHours = 24,
    maxUses = 10,
  ) {
    await this.requireOwner(meetingId, userId);

    const hours = Math.min(720, Math.max(1, Number(expiresInHours) || 24));
    const uses = Math.min(100, Math.max(1, Number(maxUses) || 10));
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase.client
      .from('meeting_invites')
      .insert({
        meeting_id: meetingId,
        token_hash: tokenHash,
        created_by: userId,
        expires_at: expiresAt,
        max_uses: uses,
      })
      .select('id, expires_at, max_uses')
      .single();

    if (error) throw new BadRequestException(error.message);

    return {
      inviteId: data.id,
      token,
      expiresAt: data.expires_at,
      maxUses: data.max_uses,
    };
  }

  async revokeInvite(inviteId: string, userId: string) {
    const { data: invite, error: lookupError } = await this.supabase.client
      .from('meeting_invites')
      .select('id, meeting_id, revoked_at')
      .eq('id', inviteId)
      .maybeSingle();

    if (lookupError) throw new BadRequestException(lookupError.message);
    if (!invite) throw new NotFoundException('Invitation not found');

    await this.requireOwner(invite.meeting_id, userId);

    if (invite.revoked_at) {
      return { success: true, message: 'Invitation already revoked' };
    }

    const { error } = await this.supabase.client
      .from('meeting_invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', inviteId)
      .is('revoked_at', null);

    if (error) throw new BadRequestException(error.message);

    return { success: true, message: 'Invitation revoked' };
  }

  async requestAdmission(token: string, userId: string, guestName: string) {
    if (!token || token.length > 200) {
      throw new BadRequestException('A valid invitation token is required');
    }

    const { data, error } = await this.supabase.client.rpc(
      'request_meeting_admission',
      {
        p_token_hash: this.hashToken(token),
        p_guest_id: userId,
        p_guest_name: guestName.trim().slice(0, 50) || 'Guest',
      },
    );

    if (error) throw new BadRequestException(error.message);

    const request = Array.isArray(data) ? data[0] : data;
    if (!request) throw new BadRequestException('Could not create admission request');

    return request;
  }

  async getAdmissionStatus(requestId: string, userId: string) {
    const { data, error } = await this.supabase.client
      .from('waiting_room_requests')
      .select('id, meeting_id, guest_id, guest_name, status')
      .eq('id', requestId)
      .eq('guest_id', userId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Admission request not found');

    const { data: meeting, error: meetingError } = await this.supabase.client
      .from('meetings')
      .select('room_code, title')
      .eq('id', data.meeting_id)
      .maybeSingle();

    if (meetingError) throw new BadRequestException(meetingError.message);
    if (!meeting) throw new NotFoundException('Meeting not found');

    return {
      requestId: data.id,
      status: data.status,
      roomCode: meeting.room_code,
      meetingTitle: meeting.title,
    };
  }

  async listWaitingRequests(meetingId: string, userId: string) {
    await this.requireOwner(meetingId, userId);

    const { data, error } = await this.supabase.client
      .from('waiting_room_requests')
      .select('id, guest_id, guest_name, status, created_at')
      .eq('meeting_id', meetingId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async reviewRequest(
    requestId: string,
    userId: string,
    status: 'admitted' | 'rejected',
  ) {
    if (status !== 'admitted' && status !== 'rejected') {
      throw new BadRequestException('Status must be admitted or rejected');
    }

    const { data: request, error: requestError } = await this.supabase.client
      .from('waiting_room_requests')
      .select('id, meeting_id, status')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) throw new BadRequestException(requestError.message);
    if (!request) throw new NotFoundException('Waiting-room request not found');

    await this.requireOwner(request.meeting_id, userId);

    if (request.status !== 'pending') {
      throw new BadRequestException('This request has already been reviewed');
    }

    const { data, error } = await this.supabase.client
      .from('waiting_room_requests')
      .update({
        status,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id, meeting_id, guest_id, guest_name, status')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new BadRequestException('Request was already reviewed');

    return data;
  }
}
