import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from './supabase.service.js';

@Injectable()
export class WorkspaceService {
  constructor(private readonly supabase: SupabaseService) {}

  private async ownedMeeting(meetingId: string, userId: string) {
    const { data, error } = await this.supabase.client.from('meetings')
      .select('id,host_id,title,room_code,starts_at,duration_minutes')
      .eq('id', meetingId).maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Meeting not found');
    if (data.host_id !== userId) throw new ForbiddenException('Only the host can view this report');
    return data;
  }

  async report(meetingId: string, userId: string) {
    const meeting = await this.ownedMeeting(meetingId, userId);
    const [a, m, r] = await Promise.all([
      this.supabase.client.from('meeting_attendance').select('id,user_id,display_name,joined_at,left_at').eq('meeting_id', meetingId).order('joined_at'),
      this.supabase.client.from('meeting_messages').select('id').eq('meeting_id', meetingId),
      this.supabase.client.from('meeting_recordings').select('id,storage_path,file_name,duration_seconds,created_at').eq('meeting_id', meetingId).order('created_at', { ascending: false }),
    ]);
    for (const x of [a,m,r]) if (x.error) throw new BadRequestException(x.error.message);
    const attendance = a.data ?? [];
    const unique = new Set(attendance.map(x => x.user_id));
    const participantSeconds = attendance.reduce((sum, x) => sum + Math.max(0, ((x.left_at ? Date.parse(x.left_at) : Date.now()) - Date.parse(x.joined_at))/1000), 0);
    return {
      meeting, attendance, recordings: r.data ?? [],
      summary: {
        attendanceSessions: attendance.length,
        uniqueParticipants: unique.size,
        activeParticipants: attendance.filter(x => !x.left_at).length,
        messageCount: m.data?.length ?? 0,
        totalParticipantMinutes: Math.round(participantSeconds/60),
      },
    };
  }

  async startAttendance(meetingId: string, userId: string, name: string) {
    const { data: meeting, error: lookupError } = await this.supabase.client.from('meetings').select('id').eq('id', meetingId).maybeSingle();
    if (lookupError) throw new BadRequestException(lookupError.message);
    if (!meeting) throw new NotFoundException('Meeting not found');
    const { data, error } = await this.supabase.client.from('meeting_attendance').insert({
      meeting_id: meetingId, user_id: userId, display_name: String(name || 'Guest').slice(0,60), joined_at: new Date().toISOString(),
    }).select('id').single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async endAttendance(id: string, userId: string) {
    const { data, error } = await this.supabase.client.from('meeting_attendance')
      .update({ left_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
      .is('left_at', null).select('id').maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Active attendance record not found');
    return data;
  }

  async reminders(userId: string) {
    const { data, error } = await this.supabase.client.from('meeting_reminders')
      .select('id,meeting_id,remind_at,channel,sent_at,meetings(title,room_code,starts_at)')
      .eq('user_id', userId).order('remind_at');
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async addReminder(userId: string, meetingId: string, remindAt: string) {
    const date = new Date(remindAt);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new BadRequestException('Reminder must be in the future');
    const meeting = await this.ownedMeeting(meetingId, userId);
    const { data, error } = await this.supabase.client.from('meeting_reminders')
      .insert({ meeting_id: meeting.id, user_id: userId, remind_at: date.toISOString(), channel: 'in_app' }).select('*').single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteReminder(userId: string, id: string) {
    const { error } = await this.supabase.client.from('meeting_reminders').delete().eq('id', id).eq('user_id', userId);
    if (error) throw new BadRequestException(error.message);
    return { success: true };
  }
}
