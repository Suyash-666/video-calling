import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from './supabase.service.js';
import { MeetingsService } from './meetings.service.js';

@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly meetings: MeetingsService,
  ) {}

  private async authenticate(authorization?: string) {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('Bearer access token required');

    const user = await this.supabase.verifyUser(match[1]);
    if (!user) throw new UnauthorizedException('Invalid or expired access token');

    return user;
  }

  @Post(':meetingId/invites')
  async createInvite(
    @Param('meetingId') meetingId: string,
    @Headers('authorization') authorization: string,
    @Body() body: { expiresInHours?: number; maxUses?: number },
  ) {
    const user = await this.authenticate(authorization);
    return this.meetings.createInvite(
      meetingId,
      user.id,
      body?.expiresInHours,
      body?.maxUses,
    );
  }

  @Patch('invites/:inviteId/revoke')
  async revokeInvite(
    @Param('inviteId') inviteId: string,
    @Headers('authorization') authorization: string,
  ) {
    const user = await this.authenticate(authorization);
    return this.meetings.revokeInvite(inviteId, user.id);
  }

  @Post('admission')
  async requestAdmission(
    @Headers('authorization') authorization: string,
    @Body() body: { token?: string; name?: string },
  ) {
    const user = await this.authenticate(authorization);
    return this.meetings.requestAdmission(
      String(body?.token ?? ''),
      user.id,
      String(body?.name ?? 'Guest'),
    );
  }

  @Get('admission/:requestId')
  async getAdmissionStatus(
    @Param('requestId') requestId: string,
    @Headers('authorization') authorization: string,
  ) {
    const user = await this.authenticate(authorization);
    return this.meetings.getAdmissionStatus(requestId, user.id);
  }

  @Get(':meetingId/waiting-room')
  async listWaitingRequests(
    @Param('meetingId') meetingId: string,
    @Headers('authorization') authorization: string,
  ) {
    const user = await this.authenticate(authorization);
    return this.meetings.listWaitingRequests(meetingId, user.id);
  }

  @Patch('waiting-room/:requestId')
  async reviewRequest(
    @Param('requestId') requestId: string,
    @Headers('authorization') authorization: string,
    @Body() body: { status?: 'admitted' | 'rejected' },
  ) {
    const user = await this.authenticate(authorization);
    return this.meetings.reviewRequest(
      requestId,
      user.id,
      body?.status as 'admitted' | 'rejected',
    );
  }
}
