import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CallGateway } from './call.gateway.js';
import { SupabaseService } from './supabase.service.js';
import { MeetingsController } from './meetings.controller.js';
import { MeetingsService } from './meetings.service.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [MeetingsController, WorkspaceController],
  providers: [CallGateway, SupabaseService, MeetingsService, WorkspaceService],
  exports: [SupabaseService, MeetingsService],
})
export class AppModule {}
