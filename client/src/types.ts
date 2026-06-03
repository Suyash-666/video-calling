// Shared type aliases used by the WebRTC hook and UI.
// Kept tiny on purpose — we only model what the UI needs to know.

export type CallStatus = 'idle' | 'joining' | 'in-call' | 'error';

// Hard ceiling for the mesh. At 6 each peer holds 5 RTCPeerConnections
// and uploads 5 video streams — the practical upper bound for full mesh
// before you'd want an SFU. Surfaced here so the UI can show "X / MAX".
export const MAX_PARTICIPANTS = 6;

// The five reaction emojis the picker offers. Kept as a const tuple so
// the type of `Reaction['emoji']` is the literal union (not just string).
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

// A live reaction someone fired. Lives in state for ~3 seconds, then is
// dropped automatically. `id` is a per-event uuid so two identical
// emojis from the same person can co-exist briefly without React key
// collisions.
export interface Reaction {
  id: string;
  // The user id of whoever fired it. Matches Participant.id, or selfId
  // for ones we sent ourselves.
  from: string;
  emoji: ReactionEmoji;
  at: number;
}

export interface MediaControls {
  micOn: boolean;
  camOn: boolean;
  // True while we're broadcasting the screen instead of the camera.
  // The video sender's track is swapped via RTCRtpSender.replaceTrack(),
  // so no SDP renegotiation is needed.
  screenOn: boolean;
  // True while the camera is being piped through the background-blur
  // pipeline (TensorFlow body segmentation). Mutually exclusive with
  // screen share — sharing wins.
  blurOn: boolean;
  // True while the blur model is loading on first toggle-on. Lets the
  // UI show a spinner instead of a dead button.
  blurLoading: boolean;
  toggleMic: () => void;
  toggleCam: () => void;
  // Toggles screen sharing on/off. If the user dismisses the browser's
  // display-picker, this is a no-op and `screenOn` stays false.
  toggleScreenShare: () => Promise<void>;
  // Toggles background blur on/off. First call loads the segmentation
  // model (~2.5MB) and may take a couple seconds on a fresh page load.
  toggleBlur: () => Promise<void>;
}

// What we know about each participant in the room, derived from presence
// + (for remote peers) WebRTC connection state. The local user is
// included as the first entry of `participants` in the hook's output —
// see UseWebRTCResult.participants.
export interface Participant {
  id: string;
  // Display name. Currently the email's local-part (everything before '@')
  // or 'You' for self when no email is available. Cheap, no schema change.
  name: string;
  // True if this user is the room host (the creator). Carried in presence.
  isHost: boolean;
  // Self vs remote. The UI uses this to label / not-mirror.
  isSelf: boolean;
  // Live media state, mirrored via presence so every peer sees toggles
  // without needing to inspect the RTP stream.
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  // The MediaStream to render in the participant's video tile. For the
  // local user this is the camera/screen stream; for a remote peer it's
  // the per-peer remote stream owned by the hook. Null while connecting.
  stream: MediaStream | null;
  // True once at least one track has arrived (remote only; always true
  // for self once the camera has been granted).
  hasMedia: boolean;
  // RTCPeerConnection.connectionState for remote peers; 'connected' for self.
  connectionState: RTCPeerConnectionState;
}

// A chat message as it lives in the UI. `id` is the database row id
// (or a temporary local id for messages we haven't sent yet). `userId`
// is the author — used to bucket messages into "me" vs "peer" without
// trusting a self-claim in the payload.
export interface ChatMessage {
  id: string;
  userId: string;
  from: 'me' | 'peer';
  text: string;
  at: number;
}

// One person waiting in the waiting room, as the host sees it. Mirrors
// public.room_join_requests + we keep client-side `decided` markers so
// approve/reject feel instant before the postgres_changes echo lands.
export interface PendingRequest {
  id: string;
  userId: string;
  displayName: string | null;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected';
}

// Self-side waiting state, while we wait for the host to approve us.
export interface WaitingState {
  requestId: string;
  roomId: string;
  inviteToken: string;
  status: 'pending' | 'rejected';
  // Wall-clock when we entered the room. Drives the "Waiting for…" timer.
  startedAt: number;
}

// Public surface of the recording subsystem.
export interface RecordingControls {
  // Are we currently recording.
  isRecording: boolean;
  // Seconds elapsed since recording started. 0 when not recording.
  elapsedSec: number;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
}

export interface UseWebRTCResult {
  status: CallStatus;
  error: string | null;
  roomId: string | null;
  role: 'host' | 'guest' | null;
  localStream: MediaStream | null;
  // Everyone in the room (self first, then remotes in join order). Replaces
  // the old separate `localStream` + `participants` modeling for sidebar /
  // grid rendering — both still derive from this.
  participants: Participant[];
  // participants.length. Convenience for the header chip.
  participantCount: number;
  controls: MediaControls;
  // Recent reactions (last ~3s, auto-pruned by the hook).
  reactions: Reaction[];
  sendReaction: (emoji: ReactionEmoji) => void;
  // Raise/lower own hand.
  toggleHand: () => void;
  // Host-only. Broadcasts a "lower all" instruction; every recipient
  // (including the sender) drops their handRaised flag.
  lowerAllHands: () => void;
  recording: RecordingControls;
  chat: ChatMessage[];
  chatLoading: boolean;
  sendChat: (text: string) => void;
  joinRoom: (roomId: string, inviteToken?: string) => Promise<void>;
  createInvite: (expiresInSeconds?: number) => Promise<string | null>;
  // Waiting room — guest side.
  // Non-null while we're stuck in the waiting room.
  waiting: WaitingState | null;
  // Abandon a waiting state (also tears down the realtime channel watching it).
  cancelWaiting: () => void;
  // Waiting room — host side.
  pendingRequests: PendingRequest[];
  approveRequest: (requestId: string) => Promise<void>;
  rejectRequest: (requestId: string) => Promise<void>;
  // Host-only toggle. Persists to public.rooms.waiting_room_enabled.
  waitingRoomEnabled: boolean;
  setWaitingRoomEnabled: (enabled: boolean) => Promise<void>;
  hangUp: () => void;
}
