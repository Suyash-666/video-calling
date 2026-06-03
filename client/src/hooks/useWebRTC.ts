// hooks/useWebRTC.ts
// The whole WebRTC dance lives in this single hook so the UI stays declarative.
// High-level flow:
//   1. Ask the browser for camera + mic (getUserMedia).
//   2. Open a Supabase Realtime channel and "join" a room by subscribing.
//   3. Use Realtime presence to figure out who else is in the room.
//      Whoever is the second person in the room creates a WebRTC offer.
//   4. The first person answers, and they exchange ICE candidates.
//   5. The browser establishes a direct peer connection — media flows P2P,
//      the server is not in the media path. (Supabase Realtime is the
//      signaling channel only; no media touches Supabase.)
//
// Chat is persisted:
//   - On join: SELECT the last N messages for the room from `public.messages`.
//   - On send: INSERT a row. The author's `user_id` is set by RLS via auth.uid().
//   - Realtime: subscribe to `postgres_changes` filtered by room_id so that
//     inserts from the peer (and from other tabs of the same user) appear
//     instantly without us needing a separate broadcast path.
//
// Auth: the Supabase JS client automatically attaches the current user's
// access token to Realtime WebSocket connections, so when Realtime is
// configured to require authentication (see supabase/migrations/0001_*.sql
// in the repo), anonymous subscribers are rejected by the server.

import { useCallback, useEffect, useRef, useState } from 'react';
import { roomChannel, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { ChatMessage, UseWebRTCResult } from '../types';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Public STUN servers. They help two peers discover their public IP/port
// so the connection can traverse NATs. Free and good enough for an MVP.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

// How many historical messages to load when joining a room.
const HISTORY_LIMIT = 50;

// How the user is joining a room, used to choose the right RPC.
//   'host'  -> create the room + add ourselves as host
//   'guest' -> redeem an invite token
async function joinRoomRpc(
  room: string,
  mode: 'host' | 'guest',
  inviteToken?: string
): Promise<void> {
  if (mode === 'host') {
    const { error } = await supabase.rpc('create_room_with_host', {
      p_room_id: room,
    });
    if (error) throw new Error(error.message);
    return;
  }
  // mode === 'guest'
  if (!inviteToken) {
    throw new Error('An invite token is required to join a private room.');
  }
  const { error } = await supabase.rpc('redeem_invite', {
    p_room_id: room,
    p_token: inviteToken,
  });
  if (error) throw new Error(error.message);
}

export function useWebRTC(): UseWebRTCResult {
  const { user } = useAuth();
  const selfId = user?.id ?? '';

  const [status, setStatus] = useState<UseWebRTCResult['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [role, setRole] = useState<UseWebRTCResult['role']>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<UseWebRTCResult['remote']>({
    hasRemote: false,
    remoteStream: null,
  });
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Refs hold mutable WebRTC + channel objects outside React's render cycle.
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roomIdRef = useRef<string | null>(null);

  // --- WebRTC plumbing (unchanged) ------------------------------------------

  const startLocalMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      return stream;
    } catch (e: any) {
      setError(`Could not access camera/mic: ${e?.message ?? e}`);
      setStatus('error');
      throw e;
    }
  }, []);

  const createPeer = useCallback((stream: MediaStream) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (ev) => {
      const incoming = ev.streams[0] ?? new MediaStream([ev.track]);
      setRemote({ hasRemote: true, remoteStream: incoming });
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { candidate: ev.candidate.toJSON() },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        setError(`Connection ${pc.connectionState}`);
      }
    };

    return pc;
  }, []);

  const startCall = useCallback(async () => {
    const pc = pcRef.current;
    const ch = channelRef.current;
    if (!pc || !ch) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ch.send({ type: 'broadcast', event: 'offer', payload: { sdp: offer } });
  }, []);

  const attachSignaling = useCallback(
    (ch: RealtimeChannel) => {
      const onOffer = async ({ payload }: { payload: { sdp: RTCSessionDescriptionInit } }) => {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ch.send({ type: 'broadcast', event: 'answer', payload: { sdp: answer } });
      };

      const onAnswer = async ({ payload }: { payload: { sdp: RTCSessionDescriptionInit } }) => {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        setStatus('in-call');
      };

      const onIce = async ({ payload }: { payload: { candidate: RTCIceCandidateInit } }) => {
        const pc = pcRef.current;
        if (!pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // Benign: candidates can arrive before remote description is set
          // in some browsers. The next candidate event will usually fix it.
        }
      };

      ch.on('broadcast', { event: 'offer' }, onOffer as any);
      ch.on('broadcast', { event: 'answer' }, onAnswer as any);
      ch.on('broadcast', { event: 'ice-candidate' }, onIce as any);

      // Presence: when both sides are tracked, decide who's the caller.
      // We need a *deterministic* rule so exactly one peer initiates.
      // Without this, both peers' presence-sync fires when the second
      // joins, both see the other as "remote", both have localDescription
      // === null, and both call startCall() — i.e. "glare". The two offers
      // then collide in have-local-offer state and the negotiation fails,
      // which is why chat works but video never connects.
      //
      // Rule: the peer with the lexicographically smaller user id is the
      // caller. Same rule on both sides => exactly one offer.
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        const others = (Object.values(state).flat() as Array<{ id?: string }>)
          .filter((p) => p?.id && p.id !== selfId);
        if (others.length === 0) return;
        const peerId = others[0].id as string;
        const iAmCaller = selfId < peerId;
        if (iAmCaller && pcRef.current && !pcRef.current.localDescription) {
          startCall();
        }
      });

      ch.on('presence', { event: 'leave' }, () => {
        setRemote({ hasRemote: false, remoteStream: null });
        setChat((prev) => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            userId: 'system',
            from: 'peer',
            text: '(peer left)',
            at: Date.now(),
          },
        ]);
      });
    },
    [startCall, selfId]
  );

  // --- Chat history ---------------------------------------------------------

  // Load the last N messages for a room. RLS limits what we can see.
  const loadHistory = useCallback(async (room: string) => {
    setChatLoading(true);
    try {
      const { data, error: err } = await supabase
        .from('messages')
        .select('id, user_id, text, created_at')
        .eq('room_id', room)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      if (err) {
        setError(`Could not load chat history: ${err.message}`);
        return;
      }
      // Reverse so the panel shows oldest-first.
      const rows = (data ?? []).slice().reverse();
      const mapped: ChatMessage[] = rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        from: r.user_id === selfId ? 'me' : 'peer',
        text: r.text,
        at: new Date(r.created_at).getTime(),
      }));
      setChat(mapped);
    } finally {
      setChatLoading(false);
    }
  }, [selfId]);

  // Subscribe to new inserts on the messages table for this room.
  // We use a *separate* channel from the signaling one, because the
  // channel-level filter syntax differs and we want them with
  // different lifecycles (chat outlives the WebRTC handshake on
  // hang up if you ever change your mind about that).
  const attachChatSubscription = useCallback(
    (room: string) => {
      const ch = supabase
        .channel(`messages:${room}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${room}` },
          (payload) => {
            const row: any = payload.new;
            const msg: ChatMessage = {
              id: row.id,
              userId: row.user_id,
              from: row.user_id === selfId ? 'me' : 'peer',
              text: row.text,
              at: new Date(row.created_at).getTime(),
            };
            setChat((prev) => {
              // Dedupe: an INSERT for a message we just sent will echo
              // back. If we already have a row with this id, skip.
              if (prev.some((m) => m.id === msg.id)) return prev;
              return [...prev, msg];
            });
          }
        )
        .subscribe();
      return ch;
    },
    [selfId]
  );

  // --- Room lifecycle -------------------------------------------------------

  const joinRoom = useCallback(
    async (targetRoomId: string, inviteToken?: string) => {
      const id = targetRoomId.trim();
      if (!id) return;

      if (!user) {
        setError('You must be signed in to join a room.');
        setStatus('error');
        return;
      }

      setStatus('joining');
      setError(null);
      setRoomId(id);
      roomIdRef.current = id;
      setChat([]);

      // Pick the mode up front. The lobby decides "host" when the
      // user clicks Create Room, and "guest" when they click Join
      // Room (with a token). We default to host so a Join without a
      // token still works for the open-room case during local dev.
      const mode: 'host' | 'guest' = inviteToken ? 'guest' : 'host';

      try {
        // 0. Membership. The two RPCs are the only paths the server
        //    allows to write to `room_members`. The guest path
        //    requires a valid unused unexpired invite token.
        await joinRoomRpc(id, mode, inviteToken);
       setRole(mode);

        // 1. Media first.
        const stream = await startLocalMedia();
        // 2. Peer connection.
        createPeer(stream);
        // 3. Realtime signaling channel.
        const ch = roomChannel(id);
        attachSignaling(ch);
        channelRef.current = ch;

        await new Promise<void>((resolve, reject) => {
          ch.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
  await ch.track({ id: selfId, joinedAt: Date.now() });
  setStatus('in-call');
  resolve();
} else if (
              status === 'CHANNEL_ERROR' ||
              status === 'TIMED_OUT' ||
              status === 'CLOSED'
            ) {
              reject(new Error(`Channel status: ${status}`));
            }
          });
        });

        // 4. Chat history + live subscription. We do this AFTER the
        //    signaling channel is up so the order of "Connected" UI
        //    updates feels natural.
        await loadHistory(id);
        attachChatSubscription(id);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to join room');
        setStatus('error');
      }
    },
    [attachSignaling, attachChatSubscription, createPeer, loadHistory, startLocalMedia, user, selfId]
  );

  const hangUp = useCallback(() => {
    channelRef.current?.unsubscribe();
    channelRef.current = null;

    // Tear down the messages subscription too. We find it by name
    // pattern; removeChannel also accepts the channel object directly.
    supabase.removeAllChannels();

    const pc = pcRef.current;
    if (pc) {
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
    }
    pcRef.current = null;

    localStream?.getTracks().forEach((t) => t.stop());
    setLocalStream(null);
    setRemote({ hasRemote: false, remoteStream: null });
    setStatus('idle');
    setError(null);
    setRoomId(null);
    setRole(null);
    roomIdRef.current = null;
    setChat([]);
  }, [localStream]);

  useEffect(() => {
    return () => {
      hangUp();
      supabase.removeAllChannels();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Controls + chat send -------------------------------------------------

  const toggleMic = useCallback(() => {
    const stream = localStream;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }, [localStream, micOn]);

  const toggleCam = useCallback(() => {
    const stream = localStream;
    if (!stream) return;
    const next = !camOn;
    stream.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  }, [localStream, camOn]);

  const sendChat = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || !roomIdRef.current || !user) return;
      // RLS will reject this insert if `user_id` doesn't match auth.uid(),
      // so we set it from the session, never from the form.
      const { error: err } = await supabase.from('messages').insert({
        room_id: roomIdRef.current,
        user_id: user.id,
        text: clean,
      });
      if (err) {
        setError(`Could not send message: ${err.message}`);
      }
      // On success the postgres_changes subscription will append the
      // message to the panel — we don't optimistically add it.
    },
    [user]
  );

  // Host-only: mint a fresh invite token for the current room.
  // `expiresInSeconds` defaults to 24 hours; the server clamps the
  // window to a sensible range (1 minute .. 7 days).
  // Returns the token string on success, or null on failure (with
  // `error` set).
  const createInvite = useCallback(
    async (expiresInSeconds: number = 24 * 60 * 60): Promise<string | null> => {
      if (!roomIdRef.current || !user) {
        setError('You must be in a room to create an invite.');
        return null;
      }
      if (role !== 'host') {
        setError('Only the room host can create invites.');
        return null;
      }
      const { data, error: err } = await supabase.rpc('create_invite', {
        p_room_id: roomIdRef.current,
        p_expires_in_seconds: expiresInSeconds,
      });
      console.log('invite rpc result', { data, err });
      if (err || !data) {
        setError(`Could not create invite: ${err?.message ?? 'unknown error'}`);
        return null;
      }
      return data as string;
    },
    [role, user]
  );

  return {
    status,
    error,
    roomId,
    role,
    localStream,
    remote,
    controls: { micOn, camOn, toggleMic, toggleCam },
    chat,
    chatLoading,
    sendChat,
    joinRoom,
    createInvite,
    hangUp,
  };
}
