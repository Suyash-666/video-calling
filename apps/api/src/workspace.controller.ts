import { Body, Controller, Delete, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from './supabase.service.js';
import { WorkspaceService } from './workspace.service.js';

@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly auth: SupabaseService, private readonly workspace: WorkspaceService) {}
  private async user(header?: string) {
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Bearer access token required');
    const user = await this.auth.verifyUser(token);
    if (!user) throw new UnauthorizedException('Invalid access token');
    return user;
  }
  @Get('meetings/:id/report')
  async report(@Param('id') id: string, @Headers('authorization') h: string) {
    const u = await this.user(h); return this.workspace.report(id, u.id);
  }
  @Post('meetings/:id/attendance/start')
  async start(@Param('id') id: string, @Headers('authorization') h: string, @Body() b: {displayName?:string}) {
    const u = await this.user(h); return this.workspace.startAttendance(id, u.id, b?.displayName || u.email || 'Guest');
  }
  @Post('attendance/:id/end')
  async end(@Param('id') id: string, @Headers('authorization') h: string) {
    const u = await this.user(h); return this.workspace.endAttendance(id, u.id);
  }
  @Get('reminders')
  async reminders(@Headers('authorization') h: string) {
    const u = await this.user(h); return this.workspace.reminders(u.id);
  }
  @Post('reminders')
  async add(@Headers('authorization') h: string, @Body() b: {meetingId?:string;remindAt?:string}) {
    const u = await this.user(h); return this.workspace.addReminder(u.id, String(b?.meetingId || ''), String(b?.remindAt || ''));
  }
  @Delete('reminders/:id')
  async remove(@Param('id') id: string, @Headers('authorization') h: string) {
    const u = await this.user(h); return this.workspace.deleteReminder(u.id, id);
  }
}
