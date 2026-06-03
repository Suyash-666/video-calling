// Shared type aliases used by the WebRTC hook and UI.
// Kept tiny on purpose — we only model what the UI needs to know.

export type CallStatus = 'idle' | 'joining' | 'in-call' | 'error';

export interface MediaControls {
  micOn: boolean;
  camOn: boolean;
  // True while we're broadcasting the screen instead of the camera.
  // The video sender's track is swapped via RTCRtpSender.replaceTrack(),
  // so no SDP renegotiation is needed.
  screenOn: boolean;
  toggleMic: () => void;
  toggleCam: () => void;
  // Toggles screen sharing on/off. If the user dismisses the browser's
  // display-picker, this is a no-op and `screenOn` stays false.
  toggleScreenShare: () => Promise<void>;
}

export interface RemoteState {
  hasRemote: boolean;
  remoteStream: MediaStream | null;
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

export interface UseWebRTCResult {
  status: CallStatus;
  error: string | null;
  roomId: string | null;
  role: 'host' | 'guest' | null;
  localStream: MediaStream | null;
  remote: RemoteState;
  controls: MediaControls;
  chat: ChatMessage[];
  chatLoading: boolean;
  sendChat: (text: string) => void;
  joinRoom: (roomId: string, inviteToken?: string) => Promise<void>;
  createInvite: (expiresInSeconds?: number) => Promise<string | null>;
  hangUp: () => void;
}
