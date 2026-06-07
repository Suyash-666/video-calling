// hooks/useWebRTC.ts
// The whole WebRTC dance lives in this single hook so the UI stays declarative.
// High-level flow (full mesh, up to MAX_PARTICIPANTS):
//   1. Ask the browser for camera + mic (getUserMedia).
//   2. Open a Supabase Realtime channel and "join" a room by subscribing.
//   3. Presence tells us who else is in the room. For every other peer we
//      open a *separate* RTCPeerConnection. Whichever side has the
//      lexicographically smaller user id sends the offer (the same rule
//      that fixed glare in the 1:1 version, now applied per pair).
//   4. Offers / answers / ICE candidates are broadcast on the same channel
//      but carry `from` + `to` fields so peers route messages by addressee
//      and ignore everything else.
//   5. The browser establishes each direct peer connection — media flows
//      P2P, the server is not in the media path. (Supabase Realtime is
//      the signaling channel only; no media touches Supabase.)
//
// Presence also carries live UI state for each peer: display name,
// host flag, mic / cam on/off, raise-hand. Toggling any of those calls
// `ch.track(...)` with the new payload, and every peer's presence-sync
// rebuilds the participants list. That's how the sidebar stays real-time
// without a dedicated channel per feature.
//
// Lightweight room events use broadcast (no DB write):
//   - `reaction`     : transient floating emoji over a tile (3s ttl)
//   - `lower-hands`  : host instructs everyone to drop their hand
//
// Chat is persisted:
//   - On join: SELECT the last N messages for the room from `public.messages`.
//   - On send: INSERT a row. The author's `user_id` is set by RLS via auth.uid().
//   - Realtime: subscribe to `postgres_changes` filtered by room_id.
//
// Recording is *local*: a MediaRecorder over a combined MediaStream made
// from the local video sender's current track (so screen share is captured
// for free) plus every audio track in the room (mic + every remote audio),
// mixed via a single AudioContext destination node. On stop, the WebM blob
// is downloaded via an anchor click. Nothing leaves the user's machine.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { roomChannel, supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useBackgroundBlur } from './useBackgroundBlur';
import {
  MAX_PARTICIPANTS,
  type ChatMessage,
  type Participant,
  type PendingRequest,
  type Reaction,
  type ReactionEmoji,
  type RecordingControls,
  type UseWebRTCResult,
  type WaitingState,
} from '../types';
import type { RealtimeChannel } from '@supabase/supabase-js';

// Public STUN servers. They help two peers discover their public IP/port
// so the connection can traverse NATs. Free and good enough for an MVP.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

const HISTORY_LIMIT = 50;
const REACTION_TTL_MS = 3000;

// Shape of one presence row, as we publish it via ch.track(...).
interface PresenceRow {
  id: string;
  name: string;
  isHost: boolean;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  joinedAt: number;
}

// Per-peer mutable WebRTC state. One PeerEntry per remote participant.
interface PeerEntry {
  pc: RTCPeerConnection;
  videoSender: RTCRtpSender | null;
  remoteStream: MediaStream;
  hasMedia: boolean;
  connectionState: RTCPeerConnectionState;
}

// How the user is joining a room, used to choose the right RPC.
// Returns the new join-request id when the host's room has waiting room
// enabled (guest must wait for approval before re-joining), or null when
// membership was granted directly (the host path or a no-waiting-room
// guest path).
async function joinRoomRpc(
  room: string,
  mode: 'host' | 'guest',
  inviteToken?: string
): Promise<string | null> {
  if (mode === 'host') {
    const { error } = await supabase.rpc('create_room_with_host', {
      p_room_id: room,
    });
    if (error) throw new Error(error.message);
    return null;
  }
  if (!inviteToken) {
    throw new Error('An invite token is required to join a private room.');
  }
  const { data, error } = await supabase.rpc('redeem_invite', {
    p_room_id: room,
    p_token: inviteToken,
  });
  if (error) throw new Error(error.message);
  // redeem_invite returns the request id when waiting room is enabled,
  // null otherwise (membership granted directly).
  return (data as string | null) ?? null;
}

// Best-effort display name from a Supabase user. Email local-part > id slug.
function displayNameFor(
  user: { email?: string | null; id: string } | null
): string {
  if (!user) return 'You';
  if (user.email) {
    const at = user.email.indexOf('@');
    return at > 0 ? user.email.slice(0, at) : user.email;
  }
  return user.id.slice(0, 6);
}

// Confirms the caller is a member of the room before we open the
// realtime channel. The realtime RLS policy in
// 0005_realtime_per_channel_auth.sql gates broadcast/presence on
// `is_room_member(room_id)`. If the membership row was just written
// (e.g. via `create_room_with_host` or `approve_join` in the same
// transaction as the RPC the client just awaited), the row IS
// committed by the time we get here — but on rare occasions the
// realtime RLS evaluator in a different session can lag a few
// hundred milliseconds. We poll for up to ~2.5s (six tries with
// linear backoff) so the channel open never races the membership
// visibility. Without this, the symptom was: the joining user
// publishes presence (succeeds), but the OTHER peers' realtime
// connection refuses to deliver the broadcast/presence diffs from
// the joiner (RLS on their side returns false), so neither side
// sees the other — even though both are in `room_members`.
// We do the check by reading `room_members` directly (also gated
// by RLS, but as the same caller that just wrote the row), which
// mirrors what the realtime RLS does and surfaces the same
// visibility state to the client.
async function verifyMembership(
  roomId: string,
  expectedUserId: string
): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
      .eq('user_id', expectedUserId)
      .maybeSingle();
    if (!error && data) return true;
    // Linear backoff: 200, 400, 600, 800, 1000, 1200ms.
    await new Promise((r) => window.setTimeout(r, 200 * (attempt + 1)));
  }
  return false;
}

// crypto.randomUUID is the cleanest portable id generator; the lib types
// in older TS may not surface it on `Crypto`, so we cast pragmatically.
function uuid(): string {
  return (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// canvas.captureStream() returns a MediaStream whose tracks may not yet
// be populated by the time it returns — the canvas needs at least one
// frame composited first. This helper waits up to ~500ms for a video
// track to appear. Used by the background-blur swap so we don't try to
// replaceTrack(null).
async function waitForFirstVideoTrack(
  stream: MediaStream | null
): Promise<MediaStreamTrack | null> {
  if (!stream) return null;
  const existing = stream.getVideoTracks()[0];
  if (existing) return existing;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (t: MediaStreamTrack | null) => {
      if (settled) return;
      settled = true;
      resolve(t);
    };
    stream.onaddtrack = (ev) => {
      if (ev.track.kind === 'video') settle(ev.track);
    };
    // Hard ceiling so callers never block forever on a misbehaving
    // canvas. captureStream(targetFps) won't emit a track until the
    // first frame is drawn, which on first start can take 1-2s while
    // the MediaPipe model loads + warms the WebGL backend.
    window.setTimeout(() => settle(stream.getVideoTracks()[0] ?? null), 3000);
  });
}

export function useWebRTC(): UseWebRTCResult {
  const { user } = useAuth();
  const selfId = user?.id ?? '';
  const selfName = useMemo(() => displayNameFor(user), [user]);

  const [status, setStatus] = useState<UseWebRTCResult['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [role, setRole] = useState<UseWebRTCResult['role']>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // The presence-derived view of remote peers. We merge this with WebRTC
  // state when building the public `participants` array.
  const [presenceRows, setPresenceRows] = useState<PresenceRow[]>([]);
  // Tick that increments whenever a PeerEntry mutates (track arrived,
  // connection state changed). The participants useMemo reads this so
  // React knows to recompute even though peersRef is a ref.
  const [peerTick, setPeerTick] = useState(0);
  const bumpPeerTick = useCallback(() => setPeerTick((n) => n + 1), []);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  // Recording state.
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  // --- Waiting room state ---------------------------------------------------
  // Guest side: non-null while we're waiting for the host to approve us.
  const [waiting, setWaiting] = useState<WaitingState | null>(null);
  // Host side: live list of pending requests for the current room.
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  // Mirrored copy of public.rooms.waiting_room_enabled for the current room.
  const [waitingRoomEnabled, setWaitingRoomEnabledState] = useState(false);

  // --- Refs (mutable state outside the React tree) --------------------------
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  // Stable join timestamp for THIS tab. Captured once on join and
  // reused on every republish so toggling mic/cam/hand doesn't
  // reshuffle the participant grid or look like a re-join.
  const joinedAtRef = useRef<number>(0);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Recording refs: held outside state so the start/stop callbacks aren't
  // recreated on every elapsedSec tick.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingMixCtxRef = useRef<AudioContext | null>(null);
  const recordingStartedAtRef = useRef<number>(0);
  const recordingTimerRef = useRef<number | null>(null);

  // Waiting-room realtime subscriptions. We keep the channel handles so
  // hangUp / cancelWaiting can unsubscribe explicitly instead of relying
  // on supabase.removeAllChannels (which would also nuke the chat channel).
  const requestsChannelRef = useRef<RealtimeChannel | null>(null);

  // --- Analytics tracking refs ----------------------------------------------
  // The host (and only the host) accumulates per-call telemetry while
  // in-call and ships it to public.record_call_session on hangUp. We
  // keep everything in refs so updates don't trigger re-renders.
  const callStartedAtRef = useRef<number | null>(null);
  const peakParticipantsRef = useRef<number>(0);
  const messageCountRef = useRef<number>(0);
  // Per-user join/leave timestamps. Keyed by user_id.
  const analyticsPeersRef = useRef<
    Map<string, { name: string | null; joinedAt: number; leftAt: number | null }>
  >(new Map());

  // --- Local media ----------------------------------------------------------
  const startLocalMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      localStreamRef.current = stream;
      return stream;
    } catch (e: any) {
      setError(`Could not access camera/mic: ${e?.message ?? e}`);
      setStatus('error');
      throw e;
    }
  }, []);

  // --- Signaling envelope ---------------------------------------------------
  const sendSignal = useCallback(
    (
      event: 'offer' | 'answer' | 'ice-candidate',
      to: string,
      payload: Record<string, unknown>
    ) => {
      const ch = channelRef.current;
      if (!ch) return;
      ch.send({
        type: 'broadcast',
        event,
        payload: { from: selfId, to, ...payload },
      });
    },
    [selfId]
  );

  // --- Peer connection lifecycle -------------------------------------------
  const createPeerFor = useCallback(
    (peerId: string, localMedia: MediaStream): PeerEntry => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      let videoSender: RTCRtpSender | null = null;
      localMedia.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, localMedia);
        if (track.kind === 'video') videoSender = sender;
      });

      // Create a tiny data channel purely as a keepalive. Symmetric
      // NATs and some corporate firewalls tear down UDP flows that
      // look idle after ~30s, which is exactly the symptom we were
      // seeing ('works for a few seconds, then disconnects'). Sending
      // a no-op on this channel every 5s keeps the NAT mapping warm
      // and trips the ICE consent freshness check. Negotiation is
      // unaffected — both sides add a data-channel m-line automatically.
      const keepaliveCh = pc.createDataChannel('keepalive', {
        ordered: false,
        maxRetransmits: 0,
      });
      let keepaliveTimer: number | null = null;
      const startKeepalive = () => {
        if (keepaliveTimer != null) return;
        keepaliveTimer = window.setInterval(() => {
          if (keepaliveCh.readyState === 'open') {
            try {
              keepaliveCh.send('ping');
            } catch {
              /* ignore */
            }
          }
        }, 5000);
      };
      keepaliveCh.onopen = startKeepalive;

      const remoteStream = new MediaStream();

      const entry: PeerEntry = {
        pc,
        videoSender,
        remoteStream,
        hasMedia: false,
        connectionState: pc.connectionState,
      };
      // Expose the timer to removePeer() so teardown can stop it.
      // Re-set it once the channel actually opens.
      (entry as any)._keepaliveTimer = null;
      keepaliveCh.onopen = () => {
        startKeepalive();
        (entry as any)._keepaliveTimer = keepaliveTimer;
      };
      peersRef.current.set(peerId, entry);

      pc.ontrack = (ev) => {
        const e = peersRef.current.get(peerId);
        if (!e) return;
        if (!e.remoteStream.getTracks().some((t) => t.id === ev.track.id)) {
          e.remoteStream.addTrack(ev.track);
        }
        ev.track.onended = () => {
          e.remoteStream.removeTrack(ev.track);
          bumpPeerTick();
        };
        e.hasMedia = true;
        bumpPeerTick();
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendSignal('ice-candidate', peerId, {
            candidate: ev.candidate.toJSON(),
          });
        } else {
          // Null candidate = end-of-candidates. Useful signal that ICE
          // gathering is finished; without it we don't know whether the
          // server-reflexive candidate list was complete.
          // eslint-disable-next-line no-console
          console.log('[zoom-mini] ICE gathering complete', peerId.slice(0, 6));
        }
      };

      pc.oniceconnectionstatechange = () => {
        // eslint-disable-next-line no-console
        console.log(
          '[zoom-mini] iceConnectionState',
          peerId.slice(0, 6),
          pc.iceConnectionState,
          'gatheringState:',
          pc.iceGatheringState
        );
      };

      pc.onconnectionstatechange = () => {
        const e = peersRef.current.get(peerId);
        if (!e) return;
        e.connectionState = pc.connectionState;
        // eslint-disable-next-line no-console
        console.log(
          '[zoom-mini] connectionState',
          peerId.slice(0, 6),
          pc.connectionState
        );
        bumpPeerTick();
      };

      // The answerer side receives the data channel that the offerer
      // created. Once it's open, also start pinging so the keepalive
      // is symmetric on both peers.
      pc.ondatachannel = (ev) => {
        const ch = ev.channel;
        if (ch.label !== 'keepalive') return;
        ch.onopen = () => {
          const t = window.setInterval(() => {
            if (ch.readyState === 'open') {
              try {
                ch.send('ping');
              } catch {
                /* ignore */
              }
            }
          }, 5000);
          const e = peersRef.current.get(peerId);
          if (e) (e as any)._keepaliveTimer = t;
        };
      };

      bumpPeerTick();
      return entry;
    },
    [sendSignal, bumpPeerTick]
  );

  const removePeer = useCallback(
    (peerId: string) => {
      const entry = peersRef.current.get(peerId);
      if (!entry) return;
      // Stop the keepalive timer before closing the PC. The timer
      // reference is attached to the entry as a non-enumerable prop
      // by createPeerFor.
      const t = (entry as any)._keepaliveTimer as number | null | undefined;
      if (t != null) {
        window.clearInterval(t);
        (entry as any)._keepaliveTimer = null;
      }
      try {
        // Closing the PC tears down its senders/receivers. Local tracks
        // live on localStream and must not be stopped here — other peers
        // are still sending them.
        entry.pc.close();
      } catch {
        /* already closed */
      }
      entry.remoteStream.getTracks().forEach((tr) => {
        entry.remoteStream.removeTrack(tr);
      });
      peersRef.current.delete(peerId);
      bumpPeerTick();
    },
    [bumpPeerTick]
  );

  const callPeer = useCallback(
    async (peerId: string) => {
      const entry = peersRef.current.get(peerId);
      if (!entry) return;
      try {
        const offer = await entry.pc.createOffer();
        await entry.pc.setLocalDescription(offer);
        sendSignal('offer', peerId, { sdp: offer });
      } catch (e: any) {
        setError(`Failed to call ${peerId.slice(0, 6)}: ${e?.message ?? e}`);
      }
    },
    [sendSignal]
  );

  // --- Presence republish ---------------------------------------------------
  // Any time our public flags change (mic/cam/hand/role), rewrite our
  // presence row. Every other peer's presence-sync fires and rebuilds
  // their sidebar without us needing a side channel.
  const publishPresence = useCallback(async () => {
    const ch = channelRef.current;
    if (!ch || !selfId) return;
    // First publish stamps joinedAtRef; subsequent publishes reuse it
    // so the row is updated in place rather than appearing as a re-join.
    if (joinedAtRef.current === 0) joinedAtRef.current = Date.now();
    const row: PresenceRow = {
      id: selfId,
      name: selfName,
      isHost: role === 'host',
      micOn,
      camOn,
      handRaised,
      joinedAt: joinedAtRef.current,
    };
    try {
      await ch.track(row);
    } catch {
      /* benign on rapid toggle */
    }
  }, [selfId, selfName, role, micOn, camOn, handRaised]);

  // Republish whenever any tracked flag changes (after the initial track
  // in joinRoom has run — channelRef will be non-null at that point).
  useEffect(() => {
    void publishPresence();
  }, [publishPresence]);

  // Periodic republish: a low-frequency safety net that re-sends the
  // current presence row so any transient Supabase Realtime glitch
  // (a missed diff, a brief WebSocket drop, an `inPendingSyncState`
  // window on the receiver) self-heals within a few seconds. Realtime
  // is reliable in steady state; this is for the failure modes the
  // debug logs surface. 4 s is short enough to feel "live" but long
  // enough to not flood the channel — the user can hand-raise / mute
  // in the gap and get the immediate republish on top.
  useEffect(() => {
    if (status !== 'in-call') return;
    const t = window.setInterval(() => {
      void publishPresence();
    }, 4000);
    return () => window.clearInterval(t);
  }, [status, publishPresence]);

  // --- Signaling + presence handlers ---------------------------------------
  const attachSignaling = useCallback(
    (ch: RealtimeChannel) => {
      const onOffer = async ({
        payload,
      }: {
        payload: {
          from: string;
          to: string;
          sdp: RTCSessionDescriptionInit;
        };
      }) => {
        if (payload.to !== selfId || payload.from === selfId) return;
        const media = localStreamRef.current;
        if (!media) return;
        const entry =
          peersRef.current.get(payload.from) ??
          createPeerFor(payload.from, media);
        try {
          // Guard against late / duplicate offers. setRemoteDescription
          // with type=offer requires signalingState to be 'stable' or
          // 'have-remote-offer' — anything else (e.g. we already
          // negotiated) and the call throws. We drop silently because
          // the existing connection is fine.
          const s = entry.pc.signalingState;
          if (s !== 'stable' && s !== 'have-remote-offer') return;
          await entry.pc.setRemoteDescription(
            new RTCSessionDescription(payload.sdp)
          );
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          sendSignal('answer', payload.from, { sdp: answer });
        } catch (e: any) {
          setError(`Offer handling failed: ${e?.message ?? e}`);
        }
      };

      const onAnswer = async ({
        payload,
      }: {
        payload: {
          from: string;
          to: string;
          sdp: RTCSessionDescriptionInit;
        };
      }) => {
        if (payload.to !== selfId || payload.from === selfId) return;
        const entry = peersRef.current.get(payload.from);
        if (!entry) return;
        try {
          // setRemoteDescription with type=answer requires
          // signalingState to be 'have-local-offer'. If a renegotiation
          // already moved us to 'stable' (or another offer came in
          // first), drop this stale answer instead of throwing
          // "Called in wrong state: stable".
          if (entry.pc.signalingState !== 'have-local-offer') return;
          await entry.pc.setRemoteDescription(
            new RTCSessionDescription(payload.sdp)
          );
        } catch (e: any) {
          setError(`Answer handling failed: ${e?.message ?? e}`);
        }
      };

      const onIce = async ({
        payload,
      }: {
        payload: {
          from: string;
          to: string;
          candidate: RTCIceCandidateInit;
        };
      }) => {
        if (payload.to !== selfId || payload.from === selfId) return;
        const entry = peersRef.current.get(payload.from);
        if (!entry) return;
        try {
          await entry.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          /* benign — see comment in 1:1 version */
        }
      };

      ch.on('broadcast', { event: 'offer' }, onOffer as any);
      ch.on('broadcast', { event: 'answer' }, onAnswer as any);
      ch.on('broadcast', { event: 'ice-candidate' }, onIce as any);

      // --- Lightweight room events ---------------------------------------

      ch.on(
        'broadcast',
        { event: 'reaction' },
        ({
          payload,
        }: {
          payload: { from: string; emoji: ReactionEmoji; at: number };
        }) => {
          // Defend against unknown emojis from a future client version.
          if (!payload?.emoji) return;
          const r: Reaction = {
            id: uuid(),
            from: payload.from,
            emoji: payload.emoji,
            at: payload.at ?? Date.now(),
          };
          setReactions((prev) => [...prev, r]);
          // Auto-prune after TTL. We schedule a single timer per reaction;
          // cheap because the list itself is tiny.
          window.setTimeout(() => {
            setReactions((prev) => prev.filter((x) => x.id !== r.id));
          }, REACTION_TTL_MS);
        }
      );

      ch.on(
        'broadcast',
        { event: 'lower-hands' },
        ({ payload }: { payload: { from: string } }) => {
          // Honor the instruction only if the sender is the room's host
          // *according to the current presence snapshot*. This means a
          // non-host can't fake the message just by inspecting the network.
          const state = ch.presenceState();
          const all = Object.values(state).flat() as unknown as PresenceRow[];
          const sender = all.find((p) => p?.id === payload.from);
          if (!sender?.isHost) return;
          setHandRaised(false);
        }
      );

      // --- Presence -------------------------------------------------------
      //
      // We listen to BOTH `sync` and `join` and route them through
      // the same refresh helper. The reasoning:
      //
      //   - `sync` fires whenever the local presenceState is
      //     recomputed server-side. It covers joins AND leaves
      //     AND any peer republishing their row.
      //   - `join` fires the moment a new peer publishes their
      //     first track, with the just-joined row as the payload.
      //     Crucially, some Realtime deployments only deliver
      //     `join` to the existing peers without an accompanying
      //     `sync` — in which case presenceState() never updates
      //     and the existing peers don't see the new joiner.
      //     Routing `join` through the same refresh path makes
      //     us robust to that delivery shape.
      //
      // The helper re-reads presenceState() in both cases, so we
      // don't depend on the payload being complete.

      const refreshPresence = () => {
        const state = ch.presenceState();
        // Dedup by user id. presenceState returns { presenceKey -> rows[] }
        // and a single tab is normally one key, but transient
        // reconnects (cold mobile networks, brief signaling loss) can
        // briefly leave a stale key alongside the fresh one. Counting
        // both as separate participants is what was inflating the
        // grid + capacity on a hand-raise toggle. Last-write-wins by
        // joinedAt (highest = most recent track), so the live row is
        // the one we surface.
        const dedup = new Map<string, PresenceRow>();
        for (const row of Object.values(state).flat() as unknown as PresenceRow[]) {
          if (!row?.id) continue;
          const existing = dedup.get(row.id);
          if (!existing || (row.joinedAt ?? 0) >= (existing.joinedAt ?? 0)) {
            dedup.set(row.id, row);
          }
        }
        const rows: PresenceRow[] = Array.from(dedup.values());

        // Soft capacity check.
        if (rows.length > MAX_PARTICIPANTS) {
          setError(
            `Room is over capacity (${rows.length}/${MAX_PARTICIPANTS}). New peers may not connect.`
          );
        }

        setPresenceRows(rows);

        // Analytics: track peak participants and join times. Only the
        // host writes analytics, but we accumulate on every client (cheap;
        // refs only) so the host-vs-guest branch lives in one place.
        if (rows.length > peakParticipantsRef.current) {
          peakParticipantsRef.current = rows.length;
        }
        for (const r of rows) {
          if (!analyticsPeersRef.current.has(r.id)) {
            analyticsPeersRef.current.set(r.id, {
              name: r.name ?? null,
              joinedAt: r.joinedAt ?? Date.now(),
              leftAt: null,
            });
          }
        }

        // Mesh reconciliation.
        const presentIds = new Set(
          rows.map((r) => r.id).filter((id) => id !== selfId)
        );
        const media = localStreamRef.current;
        if (!media) return;

        for (const existingId of Array.from(peersRef.current.keys())) {
          if (presentIds.has(existingId)) {
            // Peer is back (or never left) — cancel any pending tear-down
            // scheduled by a prior transient gap in presence.
            const e = peersRef.current.get(existingId);
            if (e && (e as any)._leaveTimer != null) {
              window.clearTimeout((e as any)._leaveTimer);
              (e as any)._leaveTimer = null;
            }
            continue;
          }
          const e = peersRef.current.get(existingId);
          if (!e) continue;
          // Don't tear down immediately on a presence gap. Realtime
          // can briefly omit a peer's row during republish, and a
          // peer-connection rebuild is expensive (offer/answer/ICE all
          // over again). Wait 3s of confirmed absence before we close.
          if ((e as any)._leaveTimer != null) continue;
          (e as any)._leaveTimer = window.setTimeout(() => {
            const stillGone = !ch
              .presenceState()
              // presenceState() returns { key -> PresenceRow[] }; flatten.
              ? true
              : !Object.values(ch.presenceState())
                  .flat()
                  .some((row: any) => row?.id === existingId);
            if (stillGone) {
              removePeer(existingId);
            } else {
              const ent = peersRef.current.get(existingId);
              if (ent) (ent as any)._leaveTimer = null;
            }
          }, 3000);
        }
        for (const peerId of presentIds) {
          if (peersRef.current.has(peerId)) {
            // Peer we thought we knew came back. If the connection
            // state is `failed` or `closed`, kick a fresh offer.
            const e = peersRef.current.get(peerId);
            if (
              e &&
              (e.pc.connectionState === 'failed' ||
                e.pc.connectionState === 'closed') &&
              selfId < peerId
            ) {
              void callPeer(peerId);
            }
            continue;
          }
          createPeerFor(peerId, media);
          if (selfId < peerId) void callPeer(peerId);
        }
      };

      ch.on('presence', { event: 'sync' }, refreshPresence);
      // The `join` payload is just the new row(s); we ignore it and
      // re-derive from presenceState() so the merge logic stays in
      // one place.
      ch.on('presence', { event: 'join' }, (payload: any) => {
        // eslint-disable-next-line no-console
        console.log('[zoom-mini] presence join', payload);
        refreshPresence();
      });

      ch.on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const arr = (leftPresences ?? []) as unknown as PresenceRow[];
        arr.forEach((p) => {
          if (!p?.id || p.id === selfId) return;
          // Analytics: stamp the leave time so the dashboard can show
          // attendance windows per participant.
          const a = analyticsPeersRef.current.get(p.id);
          if (a && a.leftAt === null) {
            a.leftAt = Date.now();
          }
          // Defer teardown — the next `sync` will confirm the leave and
          // run the 3s grace timer. We still show the system "left"
          // message immediately so the UI doesn't feel laggy.
          setChat((prev) => [
            ...prev,
            {
              id: `sys-${Date.now()}-${p.id}`,
              userId: 'system',
              from: 'peer',
              text: `${p.name ?? p.id.slice(0, 6)} left`,
              at: Date.now(),
            },
          ]);
        });
      });
    },
    [callPeer, createPeerFor, removePeer, selfId, sendSignal]
  );

  // --- Chat history ---------------------------------------------------------
  const loadHistory = useCallback(
    async (room: string) => {
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
    },
    [selfId]
  );

  const attachChatSubscription = useCallback(
    (room: string) => {
      const ch = supabase
        .channel(`messages:${room}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `room_id=eq.${room}`,
          },
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
              if (prev.some((m) => m.id === msg.id)) return prev;
              // Analytics: count every unique inbound message exactly once.
              // Sender-side count happens here too because postgres_changes
              // echoes our own INSERTs back.
              messageCountRef.current += 1;
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

  // Internal: everything we do AFTER membership exists in room_members.
  // Split out from joinRoom so the waiting-room "approved" callback can
  // call this without re-doing the RPC dance.
  const enterRoomAfterMembership = useCallback(
    async (id: string, mode: 'host' | 'guest') => {
      setRole(mode);

      // Confirm the membership is visible to the same RLS path the
      // realtime server uses before we open the channel. If the row
      // isn't visible yet, the realtime subscription would silently
      // receive no peer messages and the joiner would appear alone.
      const isMember = await verifyMembership(id, selfId);
      if (!isMember) {
        setError(
          'Could not confirm your membership in this room. Try rejoining.'
        );
        setStatus('error');
        return;
      }

      await startLocalMedia();
      // Presence key combines user id + a per-tab nonce so:
      //   - the same user in two tabs counts as two participants
      //   - a reconnect within one tab reuses the same key, so the
      //     stale row collapses in place server-side instead of
      //     piling up alongside the fresh one
      const presenceKey = `${selfId}:${uuid()}`;
      const ch = roomChannel(id, presenceKey);
      attachSignaling(ch);
      channelRef.current = ch;

      await new Promise<void>((resolve, reject) => {
        ch.subscribe(async (subStatus) => {
          if (subStatus === 'SUBSCRIBED') {
            // Stamp the stable joinedAt once; publishPresence reuses
            // the same value on every later track() so the row updates
            // in place instead of looking like a re-join.
            joinedAtRef.current = Date.now();
            const row: PresenceRow = {
              id: selfId,
              name: selfName,
              isHost: mode === 'host',
              micOn: true,
              camOn: true,
              handRaised: false,
              joinedAt: joinedAtRef.current,
            };
            // eslint-disable-next-line no-console
            console.log('[zoom-mini] presence subscribed', {
              room: id,
              mode,
              selfId,
              row,
            });
            try {
              const ack = await ch.track(row);
              // eslint-disable-next-line no-console
              console.log('[zoom-mini] presence track ack', ack);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[zoom-mini] presence track failed', e);
            }
            setStatus('in-call');
            // Clear any stale error from a previous join attempt so
            // a successful re-entry doesn't keep the red error chip
            // on screen. The error UI lives in App.tsx and reads
            // from `error`, so a single setError(null) is enough.
            setError(null);
            // Analytics: stamp the call's start time and seed our own
            // participant record. Host-only — guests don't write sessions.
            if (mode === 'host') {
              callStartedAtRef.current = Date.now();
              analyticsPeersRef.current.clear();
              peakParticipantsRef.current = 1;
              messageCountRef.current = 0;
              analyticsPeersRef.current.set(selfId, {
                name: selfName,
                joinedAt: Date.now(),
                leftAt: null,
              });
            }
            resolve();
          } else if (
            subStatus === 'CHANNEL_ERROR' ||
            subStatus === 'TIMED_OUT' ||
            subStatus === 'CLOSED'
          ) {
            reject(new Error(`Channel status: ${subStatus}`));
          }
        });
      });

      await loadHistory(id);
      attachChatSubscription(id);

      // Load the room's waiting-room flag so the host UI can render the
      // toggle in the correct state. RLS lets members SELECT the row.
      // The policy `members can read their room` calls is_room_member,
      // which returns true the moment the host's create_room_with_host
      // (or the guest's approve_join) committed. We retry briefly to
      // absorb any replication lag right after an approval.
      let waitingFlag = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: roomRow } = await supabase
          .from('rooms')
          .select('waiting_room_enabled')
          .eq('id', id)
          .maybeSingle();
        if (roomRow) {
          waitingFlag = !!roomRow.waiting_room_enabled;
          break;
        }
        // small linear backoff (200ms, 400ms)
        await new Promise((r) => window.setTimeout(r, 200 * (attempt + 1)));
      }
      setWaitingRoomEnabledState(waitingFlag);

      // Host-only: subscribe to incoming join requests and prime with any
      // already-pending rows. Guests do not need this stream.
      if (mode === 'host') {
        const { data: rows } = await supabase
          .from('room_join_requests')
          .select('id, user_id, display_name, status, created_at')
          .eq('room_id', id)
          .eq('status', 'pending')
          .order('created_at', { ascending: true });
        setPendingRequests(
          (rows ?? []).map((r: any) => ({
            id: r.id,
            userId: r.user_id,
            displayName: r.display_name ?? null,
            createdAt: new Date(r.created_at).getTime(),
            status: r.status,
          }))
        );

        const reqCh = supabase
          .channel(`requests:${id}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'room_join_requests',
              filter: `room_id=eq.${id}`,
            },
            (payload) => {
              const r: any = payload.new;
              if (r.status !== 'pending') return;
              setPendingRequests((prev) =>
                prev.some((x) => x.id === r.id)
                  ? prev
                  : [
                      ...prev,
                      {
                        id: r.id,
                        userId: r.user_id,
                        displayName: r.display_name ?? null,
                        createdAt: new Date(r.created_at).getTime(),
                        status: 'pending',
                      },
                    ]
              );
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'room_join_requests',
              filter: `room_id=eq.${id}`,
            },
            (payload) => {
              const r: any = payload.new;
              // Anything that's no longer pending leaves the inbox.
              setPendingRequests((prev) =>
                prev.filter((x) => x.id !== r.id)
              );
            }
          )
          .subscribe();
        requestsChannelRef.current = reqCh;
      }
    },
    [
      attachChatSubscription,
      attachSignaling,
      loadHistory,
      startLocalMedia,
      selfId,
      selfName,
    ]
  );

  // Guest helper: subscribe to OUR OWN request row and unblock when the
  // host flips `status` to 'approved' (or surface a rejection).
  const watchOwnRequest = useCallback(
    (requestId: string, roomIdArg: string, token: string) => {
      const ch = supabase
        .channel(`my-request:${requestId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'room_join_requests',
            filter: `id=eq.${requestId}`,
          },
          async (payload) => {
            const r: any = payload.new;
            if (r.status === 'approved') {
              // Tear down our watcher, then run the normal entry flow.
              try {
                ch.unsubscribe();
              } catch {
                /* ignore */
              }
              requestsChannelRef.current = null;
              setWaiting(null);
              try {
                await enterRoomAfterMembership(roomIdArg, 'guest');
              } catch (e: any) {
                setError(e?.message ?? 'Failed to enter the room');
                setStatus('error');
              }
            } else if (r.status === 'rejected') {
              setWaiting((w) =>
                w && w.requestId === requestId
                  ? { ...w, status: 'rejected' }
                  : w
              );
              setError('The host rejected your request to join.');
            }
          }
        )
        .subscribe();
      requestsChannelRef.current = ch;
      // Suppress lint for unused token — we keep it around in WaitingState
      // so the UI can show a "re-request" button later if we want.
      void token;
    },
    [enterRoomAfterMembership]
  );

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
      setPresenceRows([]);
      setPendingRequests([]);
      setWaiting(null);
      setWaitingRoomEnabledState(false);
      peersRef.current.clear();
      joinedAtRef.current = 0;
      setMicOn(true);
      setCamOn(true);
      setHandRaised(false);

      const mode: 'host' | 'guest' = inviteToken ? 'guest' : 'host';

      try {
        const requestId = await joinRoomRpc(id, mode, inviteToken);

        // Guest + waiting-room-enabled => pause here.
        if (requestId) {
          setWaiting({
            requestId,
            roomId: id,
            inviteToken: inviteToken ?? '',
            status: 'pending',
            startedAt: Date.now(),
          });
          setStatus('joining'); // remain in "joining" while we wait
          watchOwnRequest(requestId, id, inviteToken ?? '');
          return;
        }

        await enterRoomAfterMembership(id, mode);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to join room');
        setStatus('error');
      }
    },
    [enterRoomAfterMembership, user, watchOwnRequest]
  );

  // Guest abandons the waiting room.
  const cancelWaiting = useCallback(() => {
    try {
      requestsChannelRef.current?.unsubscribe();
    } catch {
      /* ignore */
    }
    requestsChannelRef.current = null;
    setWaiting(null);
    setStatus('idle');
    setError(null);
    setRoomId(null);
    roomIdRef.current = null;
  }, []);

  // Host actions on a single request.
  const approveRequest = useCallback(async (requestId: string) => {
    const { error: err } = await supabase.rpc('approve_join', {
      p_request_id: requestId,
    });
    if (err) {
      setError(`Approve failed: ${err.message}`);
      return;
    }
    // Optimistic: the postgres_changes UPDATE will also drop it, but doing
    // it here removes the latency between click and the row disappearing.
    setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  const rejectRequest = useCallback(async (requestId: string) => {
    const { error: err } = await supabase.rpc('reject_join', {
      p_request_id: requestId,
    });
    if (err) {
      setError(`Reject failed: ${err.message}`);
      return;
    }
    setPendingRequests((prev) => prev.filter((r) => r.id !== requestId));
  }, []);

  // Host toggle: flip waiting room on/off for the current room.
  // IMPORTANT: this only affects FUTURE redemptions of the invite
  // token. Guests who are already in the room (their membership
  // row exists) stay in the room — the realtime channels, peer
  // connections, and chat subscriptions are NOT torn down by this
  // toggle. (We deliberately do not call removeAllChannels() or
  // close peer connections here; the previous version did neither
  // either, but the comment makes the invariant explicit so a
  // future change doesn't accidentally regress it.)
  const setWaitingRoomEnabled = useCallback(
    async (enabled: boolean) => {
      const id = roomIdRef.current;
      if (!id) return;
      // Optimistic flip so the checkbox feels instant.
      setWaitingRoomEnabledState(enabled);
      const { error: err } = await supabase.rpc('set_waiting_room_enabled', {
        p_room_id: id,
        p_enabled: enabled,
      });
      if (err) {
        setError(`Could not change waiting room: ${err.message}`);
        // Roll back the optimistic state.
        setWaitingRoomEnabledState(!enabled);
        return;
      }
      // Surface the toggle in the chat so everyone can see it. This
      // also makes it obvious when the host changed the setting
      // mid-call (the only existing visible signal was the tiny
      // "On/Off" label next to the checkbox).
      setChat((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}-waiting`,
          userId: 'system',
          from: 'peer',
          text: enabled
            ? 'Waiting room turned on — new guests will be approved before joining.'
            : 'Waiting room turned off — new guests join immediately.',
          at: Date.now(),
        },
      ]);
    },
    []
  );

  // Stop a recording in progress. Declared early so hangUp / stopRecording
  // can both call it. Idempotent — safe to call when no recording active.
  const stopRecordingInternal = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        /* ignore — onstop handler does the rest */
      }
    } else {
      // No recorder active but timer may still be running on edge cases.
      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      setElapsedSec(0);
    }
  }, []);

  const hangUp = useCallback(() => {
    stopRecordingInternal();

    // Analytics: host-only. Snapshot what we observed during the call
    // and ship it in one RPC. Fire-and-forget — if it fails we don't
    // want to block teardown. We capture refs into locals first because
    // the resets below will clear them.
    const startedAt = callStartedAtRef.current;
    const room = roomIdRef.current;
    if (role === 'host' && startedAt && room) {
      const endedAt = Date.now();
      // Stamp leftAt for anyone still in the room (incl. ourselves) so
      // the recorded session has bounded participant windows.
      for (const a of analyticsPeersRef.current.values()) {
        if (a.leftAt === null) a.leftAt = endedAt;
      }
      const participantsPayload = Array.from(
        analyticsPeersRef.current.entries()
      ).map(([userId, a]) => ({
        user_id: userId,
        display_name: a.name,
        joined_at: new Date(a.joinedAt).toISOString(),
        left_at: a.leftAt ? new Date(a.leftAt).toISOString() : null,
      }));
      // The await is intentionally not awaited — we don't gate hangUp on
      // the network call. The .catch swallows errors silently because
      // we've already torn down `setError`'s consumer.
      void supabase
        .rpc('record_call_session', {
          p_room_id: room,
          p_started_at: new Date(startedAt).toISOString(),
          p_ended_at: new Date(endedAt).toISOString(),
          p_peak_participants: Math.max(1, peakParticipantsRef.current),
          p_message_count: messageCountRef.current,
          p_participants: participantsPayload,
        })
        .then(({ error: err }) => {
          if (err) console.warn('record_call_session failed', err.message);
        });
    }

    // Reset analytics refs for the next call.
    callStartedAtRef.current = null;
    peakParticipantsRef.current = 0;
    messageCountRef.current = 0;
    analyticsPeersRef.current.clear();

    try {
      requestsChannelRef.current?.unsubscribe();
    } catch {
      /* ignore */
    }
    requestsChannelRef.current = null;

    channelRef.current?.unsubscribe();
    channelRef.current = null;
    supabase.removeAllChannels();

    for (const peerId of Array.from(peersRef.current.keys())) {
      const entry = peersRef.current.get(peerId);
      if (entry) {
        try {
          entry.pc.close();
        } catch {
          /* already closed */
        }
        entry.remoteStream.getTracks().forEach((t) => {
          entry.remoteStream.removeTrack(t);
        });
      }
      peersRef.current.delete(peerId);
    }
    setPresenceRows([]);
    setPendingRequests([]);
    setWaiting(null);
    setWaitingRoomEnabledState(false);
    bumpPeerTick();

    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    cameraVideoTrackRef.current = null;
    setScreenOn(false);

    // Tear down the blur pipeline (frees GPU memory + stops the rAF loop).
    blur.stop();

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);

    setStatus('idle');
    setError(null);
    setRoomId(null);
    setRole(null);
    roomIdRef.current = null;
    setChat([]);
    setReactions([]);
    setHandRaised(false);
    joinedAtRef.current = 0;
  }, [bumpPeerTick, role, stopRecordingInternal]);

  // Keep a ref to the latest hangUp so the page-hide listener below
  // can call it without capturing a stale closure (and without
  // re-registering the listener every render).
  const hangUpRef = useRef(hangUp);
  useEffect(() => {
    hangUpRef.current = hangUp;
  }, [hangUp]);

  useEffect(() => {
    return () => {
      hangUp();
      supabase.removeAllChannels();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab-close / navigation cleanup. The React unmount effect above
  // doesn't run reliably on a hard tab close — the browser may destroy
  // the page before React gets a chance. pagehide + beforeunload fire
  // synchronously while we still have access to the DOM, so we can
  // stop camera/mic tracks and close peer connections here. Without
  // this, the camera LED can stay lit for a few seconds after the tab
  // closes on some platforms (the device handle outlives the JS
  // process until the OS reaps it).
  //
  // IMPORTANT: `pagehide` fires on EVERY visibility loss, including
  // switching tabs and minimizing the window on some browsers. If we
  // tear down the realtime channels on every pagehide, the user gets
  // a "the other side just left" blip whenever they briefly look at
  // another tab. The teardown should only happen on a *real* page
  // unload, which is signalled by `event.persisted === false` on
  // `pagehide` AND the absence of an `onFreeze` / `onResume` cycle
  // (i.e. the page is being discarded, not frozen). We use the
  // `visibilitychange` event in tandem: a real unload is the
  // pagehide that fires with `document.visibilityState === 'hidden'`
  // AND no subsequent `visibilitychange` to 'visible' within ~250ms.
  // For simplicity and reliability we just check `persisted`: a
  // persisted pagehide means "this page might come back" (bfcache) so
  // we leave the channels alone. Only an un-persisted pagehide tears
  // things down. This keeps the call alive across tab switches.
  useEffect(() => {
    const onPageHide = (e: Event) => {
      // If the page is being put in bfcache, do nothing — the browser
      // may restore it, and tearing down the channel would force
      // everyone to re-handshake on resume.
      // `persisted` is only on PageTransitionEvent; cast to read it.
      const persisted = (e as PageTransitionEvent).persisted;
      if (persisted) return;
      // Synchronous, best-effort. We deliberately do NOT use a Promise
      // here — pagehide handlers have a tight time budget and the
      // browser won't wait for an awaited teardown.
      try {
        const local = localStreamRef.current;
        if (local) local.getTracks().forEach((t) => t.stop());
        const screen = screenStreamRef.current;
        if (screen) screen.getTracks().forEach((t) => t.stop());
        for (const entry of peersRef.current.values()) {
          try {
            entry.pc.close();
          } catch {
            /* already closed */
          }
        }
        try {
          channelRef.current?.unsubscribe();
        } catch {
          /* ignore */
        }
        try {
          supabase.removeAllChannels();
        } catch {
          /* ignore */
        }
      } catch {
        /* best effort */
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, []);

  // --- Controls + chat send -------------------------------------------------
  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !camOn;
    stream.getVideoTracks().forEach((t) => (t.enabled = next));
    setCamOn(next);
  }, [camOn]);

  const toggleHand = useCallback(() => {
    setHandRaised((h) => !h);
    // The effect-driven republish in `publishPresence` will fire on
    // the next render, but we trigger an explicit republish
    // immediately so the hand state lands in the realtime channel
    // within the same animation frame as the click — important for
    // a gesture that should feel "instant" to the other side.
    // Republish is queued off the next microtask so the React state
    // has flushed and `publishPresence` reads the new value.
    queueMicrotask(() => {
      void publishPresence();
    });
  }, [publishPresence]);

  const lowerAllHands = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || role !== 'host') {
      setError('Only the host can lower all hands.');
      return;
    }
    ch.send({
      type: 'broadcast',
      event: 'lower-hands',
      payload: { from: selfId },
    });
    // Also drop our own immediately (the broadcast doesn't echo to self).
    setHandRaised(false);
    // Surface the action in chat so everyone knows the host reset
    // the queue — without this, the only visible signal is the
    // badges disappearing, which can be subtle across a multi-tile
    // grid.
    setChat((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}-hands`,
        userId: 'system',
        from: 'peer',
        text: 'The host lowered all hands.',
        at: Date.now(),
      },
    ]);
    // Republish our own presence so the row reflects the new
    // handRaised=false immediately for any peer that joins in the
    // next few seconds.
    queueMicrotask(() => {
      void publishPresence();
    });
  }, [role, selfId, publishPresence]);

  const sendReaction = useCallback(
    (emoji: ReactionEmoji) => {
      const ch = channelRef.current;
      if (!ch) return;
      const at = Date.now();
      // Local echo so we see our own reaction even though self-broadcast
      // is disabled (see lib/supabase.ts: broadcast.self = false).
      const local: Reaction = { id: uuid(), from: selfId, emoji, at };
      setReactions((prev) => [...prev, local]);
      window.setTimeout(() => {
        setReactions((prev) => prev.filter((x) => x.id !== local.id));
      }, REACTION_TTL_MS);

      ch.send({
        type: 'broadcast',
        event: 'reaction',
        payload: { from: selfId, emoji, at },
      });
    },
    [selfId]
  );

  // --- Screen sharing -------------------------------------------------------
  const stopScreenShare = useCallback(async () => {
    const cameraTrack = cameraVideoTrackRef.current;
    const screenStream = screenStreamRef.current;

    if (cameraTrack) {
      for (const entry of peersRef.current.values()) {
        if (!entry.videoSender) continue;
        try {
          await entry.videoSender.replaceTrack(cameraTrack);
        } catch (e: any) {
          setError(`Could not restore camera: ${e?.message ?? e}`);
        }
      }
    }

    screenStream?.getTracks().forEach((t) => t.stop());

    screenStreamRef.current = null;
    cameraVideoTrackRef.current = null;
    setScreenOn(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    const media = localStreamRef.current;
    if (!media) {
      setError('Not ready to share screen yet.');
      return;
    }
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
    } catch (e: any) {
      if (e?.name !== 'NotAllowedError') {
        setError(`Could not start screen share: ${e?.message ?? e}`);
      }
      return;
    }

    const screenTrack = display.getVideoTracks()[0];
    if (!screenTrack) {
      display.getTracks().forEach((t) => t.stop());
      setError('No video track in the captured display stream.');
      return;
    }

    const firstPeer = peersRef.current.values().next().value as
      | PeerEntry
      | undefined;
    const currentCamTrack =
      firstPeer?.videoSender?.track ?? media.getVideoTracks()[0] ?? null;
    cameraVideoTrackRef.current = currentCamTrack;
    screenStreamRef.current = display;

    for (const entry of peersRef.current.values()) {
      if (!entry.videoSender) continue;
      try {
        await entry.videoSender.replaceTrack(screenTrack);
      } catch (e: any) {
        setError(`Could not start screen share for a peer: ${e?.message ?? e}`);
      }
    }

    screenTrack.onended = () => {
      void stopScreenShare();
    };

    setScreenOn(true);
  }, [stopScreenShare]);

  const toggleScreenShare = useCallback(async () => {
    if (screenOn) await stopScreenShare();
    else await startScreenShare();
  }, [screenOn, startScreenShare, stopScreenShare]);

  // --- Background blur ------------------------------------------------------
  //
  // The blur hook reads the local camera stream and returns a *new*
  // MediaStream whose video track is the segmented/blurred output. We
  // swap that track onto every peer's video sender via replaceTrack(),
  // same hot-swap pattern as screen share — no SDP renegotiation.
  //
  // Mutually exclusive with screen share: if the user toggles blur while
  // sharing, we silently no-op (the screen is what peers want to see).

  const blur = useBackgroundBlur({ source: localStream });

  const stopBlur = useCallback(async () => {
    // Restore the camera track on every peer first, THEN tear down the
    // blur pipeline. Doing it in this order means peers never briefly see
    // a frozen frame between the swap-back and the canvas stopping.
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] ?? null;
    if (cameraTrack) {
      for (const entry of peersRef.current.values()) {
        if (!entry.videoSender) continue;
        try {
          await entry.videoSender.replaceTrack(cameraTrack);
        } catch (e: any) {
          setError(`Could not restore camera: ${e?.message ?? e}`);
        }
      }
    }
    blur.stop();
  }, [blur]);

  const startBlur = useCallback(async () => {
    if (screenOn) {
      // Don't interfere with an active share. The user can re-toggle
      // blur after stopping the share.
      return;
    }
    if (!localStreamRef.current) {
      setError('Camera is not ready yet.');
      return;
    }
    // Get the stream directly from start() — reading blur.blurredStream
    // here would be the previous render's value (React batches state),
    // which is what caused the "failed to produce a video track" error.
    const blurred = await blur.start();
    const blurredTrack = await waitForFirstVideoTrack(blurred);
    if (!blurredTrack) {
      // blur.start() already set the hook's enabled=true. Tear it back
      // down so the user can re-toggle without being stuck in a
      // half-on state where their own preview is fine but peers see
      // no track.
      setError('Background blur failed to produce a video track.');
      blur.stop();
      return;
    }
    for (const entry of peersRef.current.values()) {
      if (!entry.videoSender) continue;
      try {
        await entry.videoSender.replaceTrack(blurredTrack);
      } catch (e: any) {
        setError(`Could not enable blur for a peer: ${e?.message ?? e}`);
      }
    }
  }, [blur, screenOn]);

  const toggleBlur = useCallback(async () => {
    if (blur.enabled) await stopBlur();
    else await startBlur();
  }, [blur.enabled, startBlur, stopBlur]);

  // When peers join *after* blur is already on, their fresh PC was set
  // up with the raw camera track in createPeerFor. Swap them now too.
  useEffect(() => {
    if (!blur.enabled || !blur.blurredStream) return;
    const track = blur.blurredStream.getVideoTracks()[0];
    if (!track) return;
    for (const entry of peersRef.current.values()) {
      // Only swap senders that aren't already using a non-camera track
      // (so we don't clobber screen-share — which can't happen given
      // the mutex above, but defense-in-depth).
      if (entry.videoSender && entry.videoSender.track !== track) {
        entry.videoSender.replaceTrack(track).catch(() => {});
      }
    }
  }, [blur.enabled, blur.blurredStream, peerTick]);

  // --- Recording ------------------------------------------------------------
  //
  // We build ONE recording MediaStream:
  //   - Video: whatever the local video sender is currently sending. We
  //     read it from the first peer's videoSender if present, else fall
  //     back to the local camera track. This means screen share is
  //     captured automatically (it's the same track we already swapped).
  //     If no peers yet, we use the local camera track directly.
  //   - Audio: every audio track in the room — our mic plus every remote
  //     audio track — summed via Web Audio's MediaStreamDestination.
  //
  // MediaRecorder asks the browser to encode this composite into WebM.
  // On stop, we glue the chunks into a Blob and trigger a download.

  const buildRecordingStream = useCallback((): MediaStream | null => {
    const localMedia = localStreamRef.current;
    if (!localMedia) return null;

    // Video: prefer whatever is currently on the wire (could be screen
    // share). Fall back to the local camera track.
    const firstPeer = peersRef.current.values().next().value as
      | PeerEntry
      | undefined;
    const videoTrack =
      firstPeer?.videoSender?.track ??
      localMedia.getVideoTracks()[0] ??
      null;
    if (!videoTrack) return null;

    // Audio: mix mic + every remote. AudioContext is required because
    // a MediaStream can hold many audio tracks but most encoders only
    // mux the first one. We create source nodes per track and sum into
    // a single destination node.
    const ctx = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    recordingMixCtxRef.current = ctx;
    const dest = ctx.createMediaStreamDestination();

    const addAudio = (stream: MediaStream) => {
      if (stream.getAudioTracks().length === 0) return;
      // AudioContext can connect a stream node even when individual tracks
      // are muted; we don't try to dedupe per track because the browser
      // already coalesces silent ones.
      const src = ctx.createMediaStreamSource(stream);
      src.connect(dest);
    };

    addAudio(localMedia);
    for (const entry of peersRef.current.values()) {
      addAudio(entry.remoteStream);
    }

    const mixed = new MediaStream();
    mixed.addTrack(videoTrack);
    dest.stream.getAudioTracks().forEach((t) => mixed.addTrack(t));
    return mixed;
  }, []);

  // Pick the best supported WebM codec the browser advertises.
  const pickMimeType = (): string => {
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const m of candidates) {
      if (
        typeof MediaRecorder !== 'undefined' &&
        MediaRecorder.isTypeSupported(m)
      ) {
        return m;
      }
    }
    return 'video/webm';
  };

  const startRecording = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return;
    if (typeof MediaRecorder === 'undefined') {
      setError('Recording is not supported in this browser.');
      return;
    }
    const stream = buildRecordingStream();
    if (!stream) {
      setError('Could not start recording: no local media yet.');
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (e: any) {
      setError(`MediaRecorder failed to initialize: ${e?.message ?? e}`);
      recordingMixCtxRef.current?.close().catch(() => {});
      recordingMixCtxRef.current = null;
      return;
    }

    recordedChunksRef.current = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        recordedChunksRef.current.push(ev.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      recordedChunksRef.current = [];

      // Anchor-click download. URL.createObjectURL is cheap to allocate
      // and we revoke immediately after the click is dispatched.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19);
      a.download = `meeting-${roomIdRef.current ?? 'recording'}-${stamp}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Slight delay so Safari has finished reading the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);

      // Tear down the audio mix.
      recordingMixCtxRef.current?.close().catch(() => {});
      recordingMixCtxRef.current = null;
      recorderRef.current = null;

      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
      setElapsedSec(0);
    };

    recorderRef.current = recorder;
    recordingStartedAtRef.current = Date.now();
    // 1s timeslice → ondataavailable fires once per second, keeping
    // chunk count bounded and giving us early data if the tab crashes.
    recorder.start(1000);
    setIsRecording(true);
    setElapsedSec(0);

    recordingTimerRef.current = window.setInterval(() => {
      setElapsedSec(
        Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
      );
    }, 250);
  }, [buildRecordingStream]);

  const stopRecording = useCallback(() => {
    stopRecordingInternal();
  }, [stopRecordingInternal]);

  const recording: RecordingControls = useMemo(
    () => ({
      isRecording,
      elapsedSec,
      startRecording,
      stopRecording,
    }),
    [isRecording, elapsedSec, startRecording, stopRecording]
  );

  const sendChat = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || !roomIdRef.current || !user) return;
      const { error: err } = await supabase.from('messages').insert({
        room_id: roomIdRef.current,
        user_id: user.id,
        text: clean,
      });
      if (err) setError(`Could not send message: ${err.message}`);
    },
    [user]
  );

  const createInvite = useCallback(
    async (
      expiresInSeconds: number = 24 * 60 * 60
    ): Promise<string | null> => {
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
      if (err || !data) {
        setError(`Could not create invite: ${err?.message ?? 'unknown error'}`);
        return null;
      }
      return data as string;
    },
    [role, user]
  );

  // --- Derive public participants array ------------------------------------
  //
  // Self is always first; remote peers follow in their presence joinedAt
  // order. peerTick is read so React recomputes on track/state changes.
  const participants: Participant[] = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = peerTick;
    const selfRow = presenceRows.find((r) => r.id === selfId);
    const others = presenceRows
      .filter((r) => r.id !== selfId)
      .sort((a, b) => (a.joinedAt ?? 0) - (b.joinedAt ?? 0));

    const list: Participant[] = [];
    if (status === 'in-call' && localStream) {
      list.push({
        id: selfId,
        name: selfRow?.name ?? selfName,
        isHost: selfRow?.isHost ?? role === 'host',
        isSelf: true,
        // Fall back to local state if the presence echo hasn't landed yet.
        micOn: selfRow?.micOn ?? micOn,
        camOn: selfRow?.camOn ?? camOn,
        handRaised: selfRow?.handRaised ?? handRaised,
        stream: localStream,
        hasMedia: true,
        connectionState: 'connected',
      });
    }
    for (const r of others) {
      const peer = peersRef.current.get(r.id);
      list.push({
        id: r.id,
        name: r.name ?? r.id.slice(0, 6),
        isHost: !!r.isHost,
        isSelf: false,
        micOn: !!r.micOn,
        camOn: !!r.camOn,
        handRaised: !!r.handRaised,
        stream: peer?.remoteStream ?? null,
        hasMedia: !!peer?.hasMedia,
        connectionState: peer?.connectionState ?? 'new',
      });
    }
    return list;
  }, [
    peerTick,
    presenceRows,
    selfId,
    selfName,
    role,
    status,
    localStream,
    micOn,
    camOn,
    handRaised,
  ]);

  return {
    status,
    error,
    roomId,
    role,
    localStream,
    participants,
    participantCount: participants.length,
    controls: {
      micOn,
      camOn,
      screenOn,
      blurOn: blur.enabled,
      blurLoading: blur.loading,
      toggleMic,
      toggleCam,
      toggleScreenShare,
      toggleBlur,
    },
    reactions,
    sendReaction,
    toggleHand,
    lowerAllHands,
    recording,
    chat,
    chatLoading,
    sendChat,
    joinRoom,
    createInvite,
    waiting,
    cancelWaiting,
    pendingRequests,
    approveRequest,
    rejectRequest,
    waitingRoomEnabled,
    setWaitingRoomEnabled,
    hangUp,
  };
}
