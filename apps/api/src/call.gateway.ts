import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { SupabaseService } from './supabase.service.js';

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      ...(process.env.WEB_ORIGIN
        ? [process.env.WEB_ORIGIN.replace(/\/$/, '')]
        : []),
    ],
  },
})
export class CallGateway {
  @WebSocketServer() server!: Server;

  constructor(private readonly supabase: SupabaseService) {}

  afterInit(server: Server) {
    server.use(async (client, next) => {
      try {
        const token = client.handshake.auth?.token;

        if (typeof token !== 'string' || !token) {
          return next(new Error('Authentication required'));
        }

        const user = await this.supabase.verifyUser(token);

        if (!user) {
          return next(new Error('Invalid or expired access token'));
        }

        client.data.userId = user.id;
        client.data.email = user.email ?? null;
        next();
      } catch {
        next(new Error('Authentication failed'));
      }
    });
  }

  private isAdmitted(client: Socket): boolean {
    const roomId = client.data.roomId;
    return Boolean(
      client.data.userId &&
      client.data.meetingId &&
      roomId &&
      client.rooms.has(roomId)
    );
  }

  private canSignalTo(client: Socket, recipientId: string): boolean {
    if (!this.isAdmitted(client) || !recipientId || recipientId === client.id) {
      return false;
    }

    const recipient = this.server.sockets.sockets.get(recipientId);

    return Boolean(
      recipient &&
      this.isAdmitted(recipient) &&
      recipient.data.roomId === client.data.roomId &&
      recipient.data.meetingId === client.data.meetingId
    );
  }

  @SubscribeMessage('join-room')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string; name: string },
  ) {
    if (!client.data.userId) return { error: 'Authentication required' };

    const roomId = String(payload?.roomId ?? '').trim().slice(0, 80);
    const name = String(payload?.name ?? 'Guest').trim().slice(0, 50) || 'Guest';

    if (!roomId) return { error: 'Room code is required' };

    const { data: meeting, error: meetingError } = await this.supabase.client
      .from('meetings')
      .select('id, host_id, starts_at, duration_minutes')
      .eq('room_code', roomId)
      .maybeSingle();

    if (meetingError || !meeting) {
      return { error: 'Meeting not found or access denied' };
    }

    const startsAt = new Date(meeting.starts_at).getTime();
    const endsAt = startsAt + Number(meeting.duration_minutes) * 60_000;
    const now = Date.now();

    if (!Number.isFinite(startsAt) || now < startsAt - 15 * 60_000 || now > endsAt) {
      return { error: 'This meeting is outside its permitted join window' };
    }

    const isHost = meeting.host_id === client.data.userId;

    if (!isHost) {
      const { data: admission, error: admissionError } = await this.supabase.client
        .from('waiting_room_requests')
        .select('id')
        .eq('meeting_id', meeting.id)
        .eq('guest_id', client.data.userId)
        .eq('status', 'admitted')
        .maybeSingle();

      if (admissionError || !admission) {
        return { error: 'Waiting for host approval' };
      }
    }

    if (client.data.roomId && client.data.roomId !== roomId) {
      await client.leave(client.data.roomId);
    }

    client.data.roomId = roomId;
    client.data.meetingId = meeting.id;
    client.data.name = name;
    client.data.isHost = isHost;
    client.data.raisedHand = false;

    await client.join(roomId);

    const sockets = await this.server.in(roomId).fetchSockets();
    const peers = sockets
      .filter((peer) => peer.id !== client.id)
      .map((peer) => ({
        id: peer.id,
        name: String(peer.data.name ?? 'Guest'),
        raisedHand: Boolean(peer.data.raisedHand),
      }));

    client.emit('room-peers', peers);

    const { data: history, error: historyError } = await this.supabase.client
      .from('meeting_messages')
      .select('id, sender_name, content, created_at')
      .eq('meeting_id', meeting.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (historyError) {
      client.emit('chat-history', []);
    } else {
      client.emit('chat-history', (history ?? []).reverse().map((message) => ({
        id: message.id,
        name: message.sender_name,
        text: message.content,
        time: message.created_at,
      })));
    }

    client.to(roomId).emit('peer-joined', {
      id: client.id,
      name,
    });

    return {
      success: true,
      roomId,
      participantCount: sockets.length,
      isHost,
    };
  }

  @SubscribeMessage('webrtc-offer')
  offer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { to: string; offer: RTCSessionDescriptionInit },
  ) {
    if (!data?.to || !data.offer || !this.canSignalTo(client, data.to)) return;
    if (data.to && data.offer) {
      this.server.to(data.to).emit('webrtc-offer', {
        from: client.id,
        offer: data.offer,
        name: client.data.name ?? 'Guest',
      });
    }
  }

  @SubscribeMessage('webrtc-answer')
  answer(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { to: string; answer: RTCSessionDescriptionInit },
  ) {
    if (!data?.to || !data.answer || !this.canSignalTo(client, data.to)) return;
    if (data.to && data.answer) {
      this.server.to(data.to).emit('webrtc-answer', {
        from: client.id,
        answer: data.answer,
      });
    }
  }

  @SubscribeMessage('webrtc-ice')
  ice(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { to: string; candidate: RTCIceCandidateInit },
  ) {
    if (!data?.to || !data.candidate || !this.canSignalTo(client, data.to)) return;
    if (data.to && data.candidate) {
      this.server.to(data.to).emit('webrtc-ice', {
        from: client.id,
        candidate: data.candidate,
      });
    }
  }

  @SubscribeMessage('chat-message')
  async chat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { text: string },
  ) {
    if (!this.isAdmitted(client)) return;

    const text = String(data?.text ?? '').trim().slice(0, 2000);
    const roomId = client.data.roomId;
    const meetingId = client.data.meetingId;
    const senderId = client.data.userId;

    if (!text || !roomId || !meetingId || !senderId) return;

    const { data: savedMessage, error } = await this.supabase.client
      .from('meeting_messages')
      .insert({
        meeting_id: meetingId,
        sender_id: senderId,
        sender_name: String(client.data.name ?? 'Guest').slice(0, 50),
        content: text,
      })
      .select('id, sender_name, content, created_at')
      .single();

    if (error || !savedMessage) {
      client.emit('chat-error', { message: 'Message could not be saved. Please try again.' });
      return;
    }

    this.server.to(roomId).emit('chat-message', {
      id: savedMessage.id,
      name: savedMessage.sender_name,
      text: savedMessage.content,
      time: savedMessage.created_at,
    });
  }

  @SubscribeMessage('raise-hand')
  raiseHand(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { raised: boolean },
  ) {
    if (!this.isAdmitted(client)) return;

    const roomId = client.data.roomId;
    client.data.raisedHand = Boolean(data?.raised);

    this.server.to(roomId).emit('peer-raised-hand', {
      id: client.id,
      name: client.data.name ?? 'Guest',
      raised: client.data.raisedHand,
    });
  }

  @SubscribeMessage('reaction')
  react(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { emoji: string },
  ) {
    if (!this.isAdmitted(client)) return;

    const allowed = ['👍', '👏', '❤️', '😂', '🎉', '😮', '👀'];
    const emoji = String(data?.emoji ?? '');
    const roomId = client.data.roomId;

    if (!roomId || !allowed.includes(emoji)) return;

    this.server.to(roomId).emit('peer-reaction', {
      id: client.id,
      name: client.data.name ?? 'Guest',
      emoji,
    });
  }

  @SubscribeMessage('lower-all-hands')
  async lowerAllHands(@ConnectedSocket() client: Socket) {
    if (!this.isAdmitted(client) || !client.data.isHost) return;

    const sockets = await this.server.in(client.data.roomId).fetchSockets();

    for (const participant of sockets) {
      participant.data.raisedHand = false;
      participant.emit('peer-raised-hand', {
        id: participant.id,
        name: participant.data.name ?? 'Guest',
        raised: false,
      });
    }

    this.server.to(client.data.roomId).emit('all-hands-lowered');
  }

  @SubscribeMessage('remove-participant')
  async removeParticipant(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { participantId: string },
  ) {
    if (!this.isAdmitted(client) || !client.data.isHost) return;

    const participantId = String(data?.participantId ?? '');
    if (!participantId || participantId === client.id) return;

    const participant = this.server.sockets.sockets.get(participantId);

    if (
      !participant ||
      !this.isAdmitted(participant) ||
      participant.data.roomId !== client.data.roomId ||
      participant.data.meetingId !== client.data.meetingId ||
      participant.data.isHost
    ) return;

    const { error } = await this.supabase.client
      .from('waiting_room_requests')
      .update({
        status: 'rejected',
        reviewed_by: client.data.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('meeting_id', client.data.meetingId)
      .eq('guest_id', participant.data.userId)
      .eq('status', 'admitted');

    if (error) return;

    participant.emit('removed-from-room', {
      message: 'The host removed you from this meeting.',
    });

    client.to(client.data.roomId).emit('peer-left', {
      id: participant.id,
      name: participant.data.name ?? 'Guest',
    });

    const oldRoom = participant.data.roomId;
    participant.data.roomId = null;
    participant.data.meetingId = null;
    participant.data.isHost = false;
    await participant.leave(oldRoom);
    participant.disconnect(true);
  }

  handleDisconnect(client: Socket) {
    const roomId = client.data.roomId;

    if (roomId) {
      client.to(roomId).emit('peer-left', {
        id: client.id,
        name: client.data.name ?? 'Guest',
      });
    }
  }
}
