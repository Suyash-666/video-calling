'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WaitingRoomPanel from './WaitingRoomPanel';
import { io, type Socket } from 'socket.io-client';
import { supabase } from '@/lib/supabase';
import { createMeetingInvite, revokeMeetingInvite } from '@/lib/meetings-api';

type Peer = { id: string; name: string; raisedHand?: boolean };
type Message = { id: string; name: string; text: string; time: string };
type Meeting = { id: string; title: string; room: string; startsAt: string; duration: number; createdAt: number };
type HistoryItem = { id: string; room: string; startedAt: number; endedAt: number; participants: number };

const SIGNAL_URL = process.env.NEXT_PUBLIC_SIGNAL_URL || 'http://localhost:4000';
const MEETINGS_KEY = 'connectcall_meetings_v1';
const HISTORY_KEY = 'connectcall_history_v1';

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function makeId(length = 8) {
  return crypto.randomUUID().replace(/-/g, '').slice(0, length).toLowerCase();
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, React.ReactNode> = {
    mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>,
    micOff: <><path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9V5a3 3 0 0 0-5.9-.7M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3m-4 0h8M3 3l18 18" /></>,
    camera: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></>,
    cameraOff: <><path d="M10 6h6v12H5a2 2 0 0 1-2-2V8m0-5 18 18M16 10l5-3v10l-3-1.8M8 6h1" /></>,
    screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
    chat: <><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-4.5a9 9 0 0 1-.9-4A8.5 8.5 0 1 1 21 11.5Z" /><path d="M8 12h8m-8-3h6" /></>,
    hand: <><path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v8a7 7 0 0 1-7 7h-2a6 6 0 0 1-4-2l-4-4a2 2 0 0 1 3-3l2 2" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3A5 5 0 0 0 13.5 3l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3A5 5 0 0 0 10.5 21l1.7-1.7" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    smile: <><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 3 4 3 4-3 4-3M9 9h.01M15 9h.01" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    back: <><path d="m15 18-6-6 6-6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.5-3" /></>,
  };
  return <svg {...common} aria-hidden="true">{paths[name] ?? paths.arrow}</svg>;
}

function Wordmark() {
  return <span className="wordmark"><i className="brand-dot" /> CONNECTCALL</span>;
}

function TextAction({ children, onClick, type = 'button', disabled = false }: { children: React.ReactNode; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean }) {
  return <button type={type} onClick={onClick} disabled={disabled} className="text-action">{children}</button>;
}

export default function Home() {
  const [name, setName] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authBusy, setAuthBusy] = useState(false);
  const [roomInput, setRoomInput] = useState('');
  const [roomId, setRoomId] = useState('');
  const [inCall, setInCall] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [reaction, setReaction] = useState('');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatText, setChatText] = useState('');
  const [panel, setPanel] = useState<'chat' | 'people' | null>(null);
  const [status, setStatus] = useState('Waiting to connect');
  const [notice, setNotice] = useState('');
  const [callStartedAt, setCallStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingWhen, setMeetingWhen] = useState('');
  const [meetingDuration, setMeetingDuration] = useState(30);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [meetingsExpanded, setMeetingsExpanded] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const videoSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const displayStreamRef = useRef<MediaStream | null>(null);
  const callStartedRef = useRef(0);

  useEffect(() => {
    setNow(Date.now());
    const initialMeetingDate = new Date(Date.now() + 15 * 60_000);
    initialMeetingDate.setMinutes(initialMeetingDate.getMinutes() - initialMeetingDate.getTimezoneOffset());
    setMeetingWhen(initialMeetingDate.toISOString().slice(0, 16));
    setMeetings(readLocal(MEETINGS_KEY, [] as Meeting[]));
    setHistory(readLocal(HISTORY_KEY, [] as HistoryItem[]));
    const savedName = localStorage.getItem('connectcall_name');
    if (savedName) setName(savedName);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!active || error || !data.session) return;
      const user = data.session.user;
      const displayName =
        user.user_metadata?.display_name ||
        user.email?.split('@')[0] ||
        'Guest';
      setName(displayName);
      setSignedIn(true);
      localStorage.setItem('connectcall_name', displayName);
    });

    const { data: { subscription } } =
      supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        if (session) {
          const user = session.user;
          const displayName =
            user.user_metadata?.display_name ||
            user.email?.split('@')[0] ||
            'Guest';
          setName(displayName);
          setSignedIn(true);
          localStorage.setItem('connectcall_name', displayName);
        } else {
          setSignedIn(false);
        }
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleAuthSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthBusy(true);
    setNotice('');

    try {
      const cleanEmail = email.trim().toLowerCase();
      const result = authMode === 'signup'
        ? await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: { data: { display_name: name.trim() } },
          })
        : await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

      if (result.error) {
        setNotice(result.error.message);
        return;
      }

      if (!result.data.session) {
        setAuthMode('signin');
        setNotice('Account created. Check your email to confirm your account, then sign in.');
        return;
      }

      const authenticatedUser = result.data.user;
      if (!authenticatedUser) {
        setNotice('Authentication succeeded, but no user was returned. Please try signing in again.');
        return;
      }

      const displayName =
        authenticatedUser.user_metadata?.display_name ||
        name.trim() ||
        cleanEmail.split('@')[0];

      setName(displayName);
      localStorage.setItem('connectcall_name', displayName);
      setSignedIn(true);
    } catch {
      setNotice('Could not connect to Supabase. Check your project URL and publishable key.');
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    if (inCall) {
      const interval = window.setInterval(() => setNow(Date.now()), 1000);
      return () => window.clearInterval(interval);
    }
  }, [inCall]);

  useEffect(() => {
    localStorage.setItem(MEETINGS_KEY, JSON.stringify(meetings));
  }, [meetings]);

  useEffect(() => {
    let active = true;
    const loadMeetings = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!active || userError || !user) return;

      const { data, error } = await supabase
        .from('meetings')
        .select('id, title, room_code, starts_at, duration_minutes, created_at')
        .eq('host_id', user.id)
        .order('starts_at', { ascending: true });

      if (!active) return;
      if (error) {
        setNotice(`Could not load cloud meetings: ${error.message}`);
        return;
      }

      setMeetings((data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        room: row.room_code,
        startsAt: row.starts_at,
        duration: row.duration_minutes,
        createdAt: new Date(row.created_at).getTime(),
      })));
    };

    void loadMeetings();
    return () => { active = false; };
  }, [signedIn]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 25)));
  }, [history]);

  const createRoom = useCallback(async (): Promise<string | null> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        setNotice('Please sign in before creating a room.');
        return null;
      }

      const code = makeId(8).toUpperCase();
      const startsAt = new Date().toISOString();

      const { data, error } = await supabase
        .from('meetings')
        .insert({
          host_id: user.id,
          title: 'Instant meeting',
          room_code: code,
          starts_at: startsAt,
          duration_minutes: 120,
        })
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Could not create meeting.');
      }

      const meeting: Meeting = {
        id: data.id,
        title: data.title,
        room: data.room_code,
        startsAt: data.starts_at,
        duration: data.duration_minutes,
        createdAt: data.created_at,
      };

      setMeetings((current) => [meeting, ...current]);
      setRoomInput(code);
      setNotice('Room created successfully.');
      return code;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create room.');
      return null;
    }
  }, []);

  const joinCall = useCallback((code: string) => {
    const clean = code.trim();
    if (!clean) {
      setNotice('Enter a room code first.');
      return;
    }
    if (!name.trim()) {
      setNotice('Enter your name first.');
      return;
    }
    setNotice('');
    setRoomId(clean);
    setInCall(true);
    setCallStartedAt(Date.now());
    callStartedRef.current = Date.now();
  }, [name]);

  useEffect(() => {
    if (!inCall) return;
    let alive = true;
    let socket: Socket | null = null;
    let stream: MediaStream | null = null;
    const connections = new Map<string, RTCPeerConnection>();
    const pendingIce = new Map<string, RTCIceCandidateInit[]>();
    const remoteNames = new Map<string, string>();

    const updatePeer = (id: string, peerName: string, raisedHand?: boolean) => {
      remoteNames.set(id, peerName || 'Guest');
      setPeers((old) => old.some((p) => p.id === id)
        ? old.map((p) => p.id === id
          ? { ...p, name: peerName || 'Guest', raisedHand: raisedHand ?? p.raisedHand ?? false }
          : p)
        : [...old, { id, name: peerName || 'Guest', raisedHand: raisedHand ?? false }]);
    };

    const removePeer = (id: string) => {
      connections.get(id)?.close();
      connections.delete(id);
      pendingIce.delete(id);
      remoteNames.delete(id);
      videoSendersRef.current.delete(id);
      setPeers((old) => old.filter((p) => p.id !== id));
      setRemoteStreams((old) => {
        const next = { ...old };
        delete next[id];
        return next;
      });
    };

    const getConnection = (id: string) => {
      let pc = connections.get(id);
      if (pc) return pc;
      pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
      if (stream) {
        stream.getTracks().forEach((track) => {
          const sender = pc!.addTrack(track, stream!);
          if (track.kind === 'video') videoSendersRef.current.set(id, sender);
        });
      }
      pc.ontrack = (event) => {
        if (!alive) return;
        const incoming = event.streams[0];
        if (incoming) setRemoteStreams((old) => ({ ...old, [id]: incoming }));
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) socket?.emit('webrtc-ice', { to: id, candidate: event.candidate.toJSON() });
      };
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === 'failed') setStatus('Connection failed — check your network');
        else if (pc?.connectionState === 'connected') setStatus('Connected');
      };
      connections.set(id, pc);
      return pc;
    };

    const connectToPeer = async (peer: Peer) => {
      if (!socket || !stream || connections.has(peer.id)) return;
      updatePeer(peer.id, peer.name);
      const pc = getConnection(peer.id);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { to: peer.id, offer: pc.localDescription });
      } catch (error) {
        console.error('Could not create call offer:', error);
      }
    };

    const start = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session?.access_token) {
          setStatus('Please sign in before joining a call');
          return;
        }

        setStatus('Requesting camera and microphone…');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!alive) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
        socket = io(SIGNAL_URL, { transports: ['websocket', 'polling'], auth: { token: session.access_token } });
        socketRef.current = socket;
        socket.on('connect', () => {
          setStatus('Connected to signaling server');
          socket?.emit(
            'join-room',
            { roomId, name: name.trim() },
            (result: { success?: boolean; error?: string; isHost?: boolean }) => {
              if (result?.success) {
                setIsHost(Boolean(result.isHost));
                setStatus('Connected to meeting');
                return;
              }

              const message = result?.error || 'The server could not admit you to this meeting.';
              setStatus(message);
              setNotice(message);
              setInCall(false);
              stream?.getTracks().forEach((track) => track.stop());
              socket?.disconnect();
              socketRef.current = null;
              localStreamRef.current = null;
              setLocalStream(null);
            },
          );
        });
        socket.on('connect_error', (error) => {
          setStatus('Server unavailable — start the backend');
          console.error(error.message);
        });
        socket.on('room-peers', async (existing: Peer[]) => {
          setPeers(existing);
          for (const peer of existing) await connectToPeer(peer);
        });
        socket.on('peer-joined', (peer: Peer) => updatePeer(peer.id, peer.name));
        socket.on('webrtc-offer', async (data: { from: string; offer: RTCSessionDescriptionInit; name: string }) => {
          if (!data?.from || !data.offer) return;
          updatePeer(data.from, data.name);
          try {
            const pc = getConnection(data.from);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            for (const candidate of pendingIce.get(data.from) ?? []) await pc.addIceCandidate(new RTCIceCandidate(candidate));
            pendingIce.delete(data.from);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket?.emit('webrtc-answer', { to: data.from, answer: pc.localDescription });
          } catch (error) { console.error('Could not answer call:', error); }
        });
        socket.on('webrtc-answer', async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
          const pc = connections.get(data?.from);
          if (!pc || !data.answer) return;
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            for (const candidate of pendingIce.get(data.from) ?? []) await pc.addIceCandidate(new RTCIceCandidate(candidate));
            pendingIce.delete(data.from);
          } catch (error) { console.error('Could not set call answer:', error); }
        });
        socket.on('webrtc-ice', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
          if (!data?.from || !data.candidate) return;
          const pc = connections.get(data.from);
          if (!pc || !pc.remoteDescription) {
            const queued = pendingIce.get(data.from) ?? [];
            queued.push(data.candidate);
            pendingIce.set(data.from, queued);
            return;
          }
          try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
          catch (error) { console.error('Could not add ICE candidate:', error); }
        });
        socket.on('peer-left', (peer: Peer) => removePeer(peer.id));
        socket.on('chat-history', (history: Message[]) => {
          setMessages((current) => {
            const merged = new Map(current.map((message) => [message.id, message]));
            for (const message of history) merged.set(message.id, message);
            return [...merged.values()].sort(
              (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
            ).slice(-100);
          });
        });
        socket.on('chat-message', (message: Message) => {
          setMessages((current) => {
            if (current.some((item) => item.id === message.id)) return current;
            return [...current, message].slice(-100);
          });
        });
        socket.on('chat-error', (data: { message: string }) => setNotice(data.message));
        socket.on('peer-raised-hand', (data: { id: string; name?: string; raised: boolean }) => {
          setPeers((old) => old.map((p) => p.id === data.id
            ? { ...p, raisedHand: data.raised }
            : p));
          setNotice(`${data.name ?? remoteNames.get(data.id) ?? 'A participant'} ${data.raised ? 'raised a hand' : 'lowered their hand'}.`);
        });
        socket.on('all-hands-lowered', () => {
          setHandRaised(false);
          setPeers((old) => old.map((peer) => ({ ...peer, raisedHand: false })));
        });
        socket.on('removed-from-room', (data: { message: string }) => {
          setNotice(data.message);
          setInCall(false);
          setIsHost(false);
          stream?.getTracks().forEach((track) => track.stop());
          socket?.disconnect();
        });
        socket.on('peer-reaction', (data: { emoji: string; name: string }) => {
          setReaction(data.emoji);
          window.setTimeout(() => setReaction(''), 2600);
          setNotice(`${data.name} reacted ${data.emoji}`);
        });
      } catch (error) {
        console.error(error);
        setStatus(error instanceof Error && error.name === 'NotAllowedError' ? 'Camera/microphone permission denied' : 'Could not access camera or microphone');
      }
    };

    void start();
    return () => {
      alive = false;
      socket?.disconnect();
      socketRef.current = null;
      connections.forEach((pc) => pc.close());
      connections.clear();
      videoSendersRef.current.clear();
      stream?.getTracks().forEach((track) => track.stop());
      displayStreamRef.current?.getTracks().forEach((track) => track.stop());
      displayStreamRef.current = null;
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStreams({});
      setPeers([]);
    };
  }, [inCall, roomId, name]);

  const toggleMic = () => {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicOn(next);
  };

  const toggleCamera = () => {
    const next = !cameraOn;
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCameraOn(next);
  };

  const toggleScreenShare = async () => {
    try {
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach((track) => track.stop());
        displayStreamRef.current = null;
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) for (const sender of videoSendersRef.current.values()) await sender.replaceTrack(cameraTrack);
        setScreenOn(false);
        setNotice('Screen sharing stopped.');
        return;
      }
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      displayStreamRef.current = display;
      const track = display.getVideoTracks()[0];
      for (const sender of videoSendersRef.current.values()) await sender.replaceTrack(track);
      track.onended = () => {
        displayStreamRef.current = null;
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) for (const sender of videoSendersRef.current.values()) void sender.replaceTrack(cameraTrack);
        setScreenOn(false);
      };
      setScreenOn(true);
      setNotice('You are sharing your screen.');
    } catch (error) {
      console.error(error);
      setNotice('Screen sharing was cancelled or unavailable.');
    }
  };

  const sendChat = (event: React.FormEvent) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || !socketRef.current?.connected) return;
    socketRef.current.emit('chat-message', { text });
    setChatText('');
  };

  const [activeInviteIds, setActiveInviteIds] = useState<Record<string, string>>({});

  const copyRoom = async () => {
    const meeting = meetings.find((item) => item.room === roomId);
    if (!meeting) {
      setNotice('Secure invitations are available for scheduled meetings. Create a scheduled meeting first.');
      return;
    }
    try {
      const invite = await createMeetingInvite(meeting.id);
      setActiveInviteIds((current) => ({ ...current, [meeting.id]: invite.inviteId }));
      const value = `${location.origin}/invite?token=${encodeURIComponent(invite.token)}`;
      await navigator.clipboard.writeText(value);
      setNotice('Secure meeting invitation copied.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create invitation.');
    }
  };

  const lowerAllHands = () => {
    if (!isHost) return;
    socketRef.current?.emit('lower-all-hands');
  };

  const removeParticipant = (participantId: string) => {
    if (!isHost || !participantId) return;
    if (!window.confirm('Remove this participant from the meeting?')) return;
    socketRef.current?.emit('remove-participant', { participantId });
  };

  const sendReaction = (emoji: string) => {
    setReaction(emoji);
    setReactionOpen(false);
    socketRef.current?.emit('reaction', { emoji });
    setNotice(`You reacted ${emoji}`);
    window.setTimeout(() => setReaction(''), 2600);
  };

  const toggleHand = () => {
    const next = !handRaised;
    setHandRaised(next);
    socketRef.current?.emit('raise-hand', { raised: next });
    setNotice(next ? 'You raised your hand.' : 'You lowered your hand.');
  };

  const leaveCall = () => {
    const start = callStartedRef.current || callStartedAt || Date.now();
    setHistory((old) => [{ id: makeId(12), room: roomId, startedAt: start, endedAt: Date.now(), participants: peers.length + 1 }, ...old].slice(0, 25));
    setInCall(false);
    setIsHost(false);
    setPeers([]);
    setPanel(null);
    setMessages([]);
    setScreenOn(false);
    setHandRaised(false);
    setCallStartedAt(0);
    callStartedRef.current = 0;
    setStatus('Waiting to connect');
  };

  const scheduleMeeting = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!meetingTitle.trim()) {
      setNotice('Give your meeting a title.');
      return;
    }
    const start = new Date(meetingWhen);
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 60_000) {
      setNotice('Choose a future date and time.');
      return;
    }

    setNotice('');
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      setNotice('Please sign in again before scheduling a meeting.');
      return;
    }

    const room = makeId(8);
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        host_id: user.id,
        title: meetingTitle.trim(),
        room_code: room,
        starts_at: start.toISOString(),
        duration_minutes: meetingDuration,
      })
      .select('id, title, room_code, starts_at, duration_minutes, created_at')
      .single();

    if (error || !data) {
      setNotice(`Could not save meeting: ${error?.message ?? 'Unknown error'}`);
      return;
    }

    const meeting: Meeting = {
      id: data.id,
      title: data.title,
      room: data.room_code,
      startsAt: data.starts_at,
      duration: data.duration_minutes,
      createdAt: new Date(data.created_at).getTime(),
    };
    setMeetings((old) => [meeting, ...old].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)));
    setMeetingTitle('');
    setScheduleOpen(false);
    setNotice(`Meeting "${meeting.title}" saved to Supabase.`);
  };

  const deleteMeeting = async (id: string) => {
    const { error } = await supabase.from('meetings').delete().eq('id', id);
    if (error) {
      setNotice(`Could not delete meeting: ${error.message}`);
      return;
    }
    setMeetings((old) => old.filter((m) => m.id !== id));
    setNotice('Meeting deleted.');
  };
  const copyMeeting = async (meeting: Meeting) => {
    try {
      const invite = await createMeetingInvite(meeting.id);
      setActiveInviteIds((current) => ({ ...current, [meeting.id]: invite.inviteId }));
      const link = `${location.origin}/invite?token=${encodeURIComponent(invite.token)}`;
      await navigator.clipboard.writeText(link);
      setNotice('Secure meeting invitation copied.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not create invitation.');
    }
  };

  const revokeInvite = async (meeting: Meeting) => {
    const inviteId = activeInviteIds[meeting.id];
    if (!inviteId) return;
    try {
      await revokeMeetingInvite(inviteId);
      setActiveInviteIds((current) => {
        const next = { ...current };
        delete next[meeting.id];
        return next;
      });
      setNotice('Invitation revoked. Previously shared link will no longer work.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not revoke invitation.');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code) {
      setRoomInput(code);
      if (params.get('approved') === '1') joinCall(code);
    }
  }, [joinCall]);

  const durationLabel = useMemo(() => {
    const seconds = Math.max(0, Math.floor((now - (callStartedAt || now)) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }, [now, callStartedAt]);

  if (!signedIn) {
    return (
      <main className="auth-layout">
        <section className="auth-story ambient-veil noise-overlay">
          <Wordmark />
          <div className="story-copy">
            <p className="micro-label">A LITTLE CLOSER, FROM ANYWHERE</p>
            <h1>Good conversations<br />start here.</h1>
            <p className="story-description">A quieter space for face-to-face conversations. Create a room, invite your people, and connect — without the noise.</p>
            <div className="story-features"><span>01 — Private rooms</span><span>02 — Live conversations</span><span>03 — No distractions</span></div>
          </div>
          <div className="story-bottom"><p>PRIVATE ROOMS · LIVE CONVERSATIONS</p><p>CONNECTCALL / 01</p></div>
        </section>
        <section className="auth-form-pane">
          <div className="mobile-brand"><Wordmark /></div>
          <div className="auth-form-wrap">
            <p className="micro-label auth-eyebrow">WELCOME</p>
            <h2>{authMode === 'signup' ? 'Create your account.' : 'Join the conversation.'}</h2>
            <p className="form-subtitle">
              {authMode === 'signup'
                ? 'Create an account to start connecting.'
                : 'Sign in to continue to your conversations.'}
            </p>
            <form className="auth-form" onSubmit={handleAuthSubmit}>
              {authMode === 'signup' && (
                <label className="field-label">YOUR NAME
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="How should we call you?" maxLength={50} required />
                </label>
              )}
              <label className="field-label">EMAIL ADDRESS
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
              </label>
              <label className="field-label">PASSWORD
                <input type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" minLength={6} required />
              </label>
              {notice && <p role="alert" className="form-subtitle">{notice}</p>}
              <div className="auth-submit-row">
                <span className="micro-label">{authMode === 'signup' ? 'NEW ACCOUNT' : 'SECURE SIGN IN'}</span>
                <TextAction type="submit" disabled={authBusy}>
                  {authBusy ? 'Please wait…' : authMode === 'signup' ? 'Create account' : 'Sign in'}
                  <Icon name="arrow" size={15} />
                </TextAction>
              </div>
            </form>
            <p className="auth-footnote"><a className="quiet-link" href="/forgot-password">Forgot password?</a></p>
            <p className="auth-footnote">
              {authMode === 'signup' ? 'Already have an account?' : 'New to ConnectCall?'}{' '}
              <button type="button" className="quiet-link" onClick={() => { setAuthMode(authMode === 'signup' ? 'signin' : 'signup'); setNotice(''); }}>
                {authMode === 'signup' ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          </div>
          <div className="auth-footer"><span>CONNECTCALL</span><span>MADE FOR CONVERSATION</span></div>
        </section>
      </main>
    );
  }

  if (!inCall) {
    const upcoming = meetings.filter((m) => Date.parse(m.startsAt) + m.duration * 60_000 > Date.now());
    const past = [...history].sort((a, b) => b.endedAt - a.endedAt);
    return (
      <main className="lobby-page">
        <header className="lobby-header">
          <Wordmark />
          <div className="lobby-user"><i className="user-dot" /> {name.toUpperCase()} <button className="quiet-link" onClick={async () => { const { error } = await supabase.auth.signOut(); if (error) setNotice(error.message); setNotice(''); }}>Sign out</button></div>
        </header>
        <section className="lobby-intro">
          <div className="lobby-heading">
            <p className="micro-label">YOUR SPACE TO CONNECT</p>
            <h1>Make room<br />for everyone.</h1>
            <p className="lobby-description">Start a conversation, schedule time with your people, or pick up where you left off.</p>
            <div className="tiny-status"><i className="status-dot" /> VIDEO CALLS ENABLED <span className="status-divider">/</span> WEBRTC</div>
          </div>
          <form className="room-form" onSubmit={(e) => { e.preventDefault(); joinCall(roomInput); }}>
            <p className="micro-label">JOIN A ROOM</p>
            <label className="field-label">ROOM CODE
              <input value={roomInput} onChange={(e) => setRoomInput(e.target.value)} placeholder="Enter room code" maxLength={80} />
            </label>
            <div className="room-actions"><TextAction type="submit">Join room <Icon name="arrow" size={15} /></TextAction><button className="quiet-action" type="button" onClick={async () => { const code = await createRoom(); if (code) joinCall(code); }}><Icon name="plus" size={15} /> Create room</button></div>
            {notice && <p className="form-notice">{notice}</p>}
          </form>
        </section>

        <section className="meeting-section">
          <div className="section-label-row"><p className="micro-label">SCHEDULED MEETINGS</p><div className="inline-tools"><span className="micro-label">{upcoming.length} UPCOMING</span><button className="quiet-action" onClick={() => setScheduleOpen((open) => !open)}><Icon name={scheduleOpen ? 'close' : 'plus'} size={14} /> {scheduleOpen ? 'Close' : 'Schedule'}</button></div></div>
          {scheduleOpen && <form className="schedule-form" onSubmit={scheduleMeeting}>
            <label className="field-label">MEETING TITLE<input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} placeholder="Weekly sync" maxLength={80} required /></label>
            <div className="schedule-form-grid"><label className="field-label">STARTS<input type="datetime-local" value={meetingWhen} onChange={(e) => setMeetingWhen(e.target.value)} required /></label><label className="field-label">DURATION<select value={meetingDuration} onChange={(e) => setMeetingDuration(Number(e.target.value))}>{[15, 30, 45, 60, 90, 120].map((d) => <option key={d} value={d}>{d} min</option>)}</select></label></div>
            <TextAction type="submit">Schedule meeting <Icon name="arrow" size={14} /></TextAction>
          </form>}
          {upcoming.length === 0 && !scheduleOpen ? <div className="meeting-empty-note">Nothing scheduled. Add a meeting and its room code will be ready when you are.</div> :
            <div className="meeting-list">{upcoming.map((m) => {
              const date = new Date(m.startsAt);
              const canJoin = Date.now() >= date.getTime() - 15 * 60_000 && Date.now() <= date.getTime() + m.duration * 60_000;
              return <article className="meeting-table-row" key={m.id}>
                <div className="meeting-when"><span>{date.toLocaleDateString([], { month: 'short', day: '2-digit' })}</span><strong>{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><small>{m.duration} min</small></div>
                <div className="meeting-name"><strong>{m.title}</strong><span>{date.toLocaleDateString([], { weekday: 'long', year: 'numeric' })}</span></div>
                <code>{m.room}</code>
                <span className={`meeting-status ${canJoin ? '' : 'past'}`}><i />{canJoin ? 'READY' : 'SCHEDULED'}</span>
                <div className="meeting-actions"><button className="row-join" onClick={() => void copyMeeting(m)} title="Copy invitation"><Icon name="copy" size={14} /></button>{activeInviteIds[m.id] && <button className="row-join muted-danger" onClick={() => void revokeInvite(m)} title="Revoke latest invitation"><Icon name="close" size={13} /></button>}<button className="row-join" onClick={() => joinCall(m.room)} title="Join now">Join <Icon name="arrow" size={13} /></button><button className="row-join muted-danger" onClick={() => deleteMeeting(m.id)} title="Remove meeting"><Icon name="close" size={13} /></button></div>
              </article>;
            })}</div>}
        </section>

        <section className="meeting-section history-section">
          <button className="section-label-row section-toggle" onClick={() => setHistoryExpanded((v) => !v)}><span className="micro-label">RECENT CALLS</span><span className="micro-label">{past.length} SAVED <span className="expand-indicator">{historyExpanded ? '−' : '+'}</span></span></button>
          {historyExpanded && (past.length ? past.slice(0, 8).map((h) => <article className="meeting-table-row history-row" key={h.id}><div className="meeting-when"><strong>{new Date(h.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><small>{new Date(h.endedAt).toLocaleDateString()}</small></div><div className="meeting-name"><strong>Room {h.room}</strong><span>Ended {Math.max(1, Math.round((h.endedAt - h.startedAt) / 60_000))} min · {h.participants} participants</span></div><code>{h.room}</code><span className="meeting-status past"><i />ENDED</span><div className="meeting-actions"><button className="row-join" onClick={() => joinCall(h.room)}>Rejoin <Icon name="arrow" size={13} /></button></div></article>) : <div className="meeting-empty-note">Your recent calls appear here after you leave a room.</div>)}
        </section>

        <section className="feature-strip"><div><p className="micro-label">MEETING TOOLS</p><strong>Workspace & reports.</strong><span><a href="/workspace" style={{ color: "var(--accent)" }}>Open analytics and attendance →</a></span></div><div><p className="micro-label">BUILT FOR THE MOMENT</p><strong>Simple by design.</strong><span>Fast room links, live chat, screen sharing, and controls in one quiet space.</span></div><div><p className="micro-label">YOUR PRIVACY</p><strong>No extra backend.</strong><span>Schedules and recent-call history stay in this browser. Calls use your existing signaling server.</span></div></section>
        <footer className="page-footer"><span>CONNECTCALL</span><span>YOUR ROOM. YOUR PEOPLE.</span><span>01 — LOBBY</span></footer>
      </main>
    );
  }

  const allParticipants = [{ id: 'self', name: `${name} (You)`, stream: localStream }, ...peers.map((p) => ({ ...p, stream: remoteStreams[p.id] ?? null }))];

  return (
    <main className="call-screen">
      <header className="call-topbar">
        <Wordmark /><span className="topbar-divider">/</span>
        <button className="room-code-button" onClick={() => void copyRoom()}><code>{roomId}</code><Icon name="copy" size={14} /><span className="copy-room-label">Copy invite</span></button>
        <div className="call-top-right"><span className="connection-state"><i />{status}</span><span className="call-duration"><Icon name="clock" size={13} /> {durationLabel}</span><button className="quiet-link top-invite" onClick={() => void copyRoom()}><Icon name="link" size={14} /> Invite</button></div>
      </header>
      {(() => {
        const hostMeeting = meetings.find((meeting) => meeting.room === roomId);
        return hostMeeting ? <WaitingRoomPanel meetingId={hostMeeting.id} /> : null;
      })()}
      <div className="call-body">
        <section className="video-stage">
          <div className={`video-grid ${allParticipants.length === 1 ? 'grid-single' : ''} ${allParticipants.length > 4 ? 'grid-many' : ''}`}>
            {allParticipants.map((person) => (
              <div className={`video-tile ${person.id === 'self' ? 'self-tile' : ''}`} key={person.id}>
                {person.stream ? <video autoPlay playsInline muted={person.id === 'self'} ref={(el) => { if (el && el.srcObject !== person.stream) el.srcObject = person.stream; }} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: person.id === 'self' && !screenOn ? 'scaleX(-1)' : 'none' }} /> : <div className="person-placeholder"><span>{person.name.slice(0, 1).toUpperCase()}</span><small>{person.id === 'self' ? 'CAMERA UNAVAILABLE' : 'CONNECTING…'}</small></div>}
                {person.id === 'self' && !cameraOn && <div className="person-placeholder tile-camera-off"><span>{name.slice(0, 1).toUpperCase()}</span><small>CAMERA OFF</small></div>}
                {person.id === 'self' && screenOn && <span className="tile-status-badge"><Icon name="screen" size={12} /> SHARING SCREEN</span>}
                {person.id === 'self' && handRaised && <span className="tile-hand-badge"><Icon name="hand" size={14} /> HAND RAISED</span>}
                {person.id !== 'self' && peers.find((peer) => peer.id === person.id)?.raisedHand && <span className="tile-hand-badge"><Icon name="hand" size={14} /> HAND RAISED</span>}
                <div className="tile-caption"><i className="caption-live" />{person.name}{person.id === 'self' && <span className="caption-subtitle">YOU</span>}</div>
              </div>
            ))}
          </div>
          {reaction && <div className="reaction-float" key={reaction}>{reaction}</div>}
          <div className="stage-note"><i className="status-dot" /> {peers.length + 1} PARTICIPANT{peers.length ? 'S' : ''} <span className="status-divider">/</span> {status}</div>
          <div className="control-dock">
            <button className={`control-button ${!micOn ? 'control-off' : ''}`} title={micOn ? 'Mute microphone' : 'Unmute microphone'} aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'} onClick={toggleMic}><Icon name={micOn ? 'mic' : 'micOff'} /></button>
            <button className={`control-button ${!cameraOn ? 'control-off' : ''}`} title={cameraOn ? 'Turn camera off' : 'Turn camera on'} aria-label="Toggle camera" onClick={toggleCamera}><Icon name={cameraOn ? 'camera' : 'cameraOff'} /></button>
            <button className={`control-button ${screenOn ? 'control-selected' : ''}`} title={screenOn ? 'Stop sharing' : 'Share screen'} aria-label="Share screen" onClick={() => void toggleScreenShare()}><Icon name="screen" /></button>
            <span className="dock-separator" />
            <button className={`control-button ${handRaised ? 'control-selected' : ''}`} title={handRaised ? 'Lower hand' : 'Raise hand'} aria-label="Toggle raised hand" onClick={toggleHand}><Icon name="hand" /></button>
            <div className="reaction-control"><button className={`control-button ${reactionOpen ? 'control-selected' : ''}`} title="Reactions" aria-label="Open reactions" onClick={() => setReactionOpen((v) => !v)}><Icon name="smile" /></button>{reactionOpen && <div className="reaction-menu">{['👍', '👏', '❤️', '😂', '🎉', '😮', '👀'].map((emoji) => <button key={emoji} onClick={() => sendReaction(emoji)}>{emoji}</button>)}</div>}</div>
            <button className={`control-button ${panel === 'people' ? 'control-selected' : ''}`} title="Participants" aria-label="Participants" onClick={() => setPanel(panel === 'people' ? null : 'people')}><Icon name="people" /><span className="participant-count">{peers.length + 1}</span></button>
            <button className={`control-button ${panel === 'chat' ? 'control-selected' : ''}`} title="Chat" aria-label="Chat" onClick={() => setPanel(panel === 'chat' ? null : 'chat')}><Icon name="chat" /></button>
            <span className="dock-separator" />
            <button className="control-button leave-button" title="Leave call" aria-label="Leave call" onClick={leaveCall}>↗</button>
          </div>
        </section>
        {panel && <aside className="call-side-panel">
          <div className="side-panel-head"><div><p className="micro-label">{panel === 'chat' ? 'MESSAGES' : 'IN THIS ROOM'}</p><span>{panel === 'chat' ? 'Room chat' : `${peers.length + 1} participants`}</span></div><button className="plain-icon" onClick={() => setPanel(null)} aria-label="Close panel"><Icon name="close" /></button></div>
          {panel === 'chat' ? <>
            <div className="chat-messages" aria-live="polite">{messages.length === 0 ? <p className="panel-empty">No messages yet.<br />Say hello to the room.</p> : messages.map((m) => <article className={`chat-message ${m.name === name ? 'own-message' : ''}`} key={m.id}><div><strong>{m.name}</strong><time>{new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>{m.text}</p></article>)}</div>
            <form className="chat-compose" onSubmit={sendChat}><input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Write a message…" maxLength={2000} aria-label="Message" /><button className="text-action" type="submit" disabled={!chatText.trim() || !socketRef.current?.connected}>Send <Icon name="arrow" size={14} /></button></form>
          </> : <>
            <div className="participant-list">{allParticipants.map((p) => {
              const raised = p.id === 'self' ? handRaised : Boolean(peers.find((peer) => peer.id === p.id)?.raisedHand);
              return <div className="participant-row" key={p.id}>
                <span className="participant-avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{p.name}</strong><small>{p.id === 'self' ? (isHost ? 'Host · You' : 'You · Online') : 'Online'}</small></span>
                {raised && <i className="hand-status" title="Hand raised"><Icon name="hand" size={14} /></i>}
                {isHost && p.id !== 'self' && <button className="text-action" onClick={() => removeParticipant(p.id)} title={`Remove ${p.name}`}>Remove</button>}
              </div>;
            })}</div>
            {isHost && <div className="side-panel-foot"><button className="text-action" onClick={lowerAllHands}>Lower all hands</button></div>}
            <div className="side-panel-foot"><span>ROOM CODE</span><strong>{roomId}</strong><button className="text-action" onClick={() => void copyRoom()}>Copy invitation <Icon name="arrow" size={13} /></button></div>
          </>}
        </aside>}
      </div>
      {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss notice"><Icon name="close" size={14} /></button></div>}
      <button className="mobile-panel-toggle" onClick={() => setMobileMenuOpen((v) => !v)}>{mobileMenuOpen ? 'Close panel' : 'Room tools'}</button>
      {mobileMenuOpen && <div className="mobile-menu"><button onClick={() => { setPanel('chat'); setMobileMenuOpen(false); }}>Open chat</button><button onClick={() => { setPanel('people'); setMobileMenuOpen(false); }}>Participants</button><button onClick={() => void copyRoom()}>Copy invite</button></div>}
    </main>
  );
}
