// lib/supabase.ts
// Single shared Supabase client + a helper that returns a Realtime channel
// scoped to a room id. We use this for ALL signaling:
//   - broadcast: offer, answer, ice-candidate
//   - presence:  figure out who else is in the room (caller/callee rule)
//   - postgres_changes (set up in useWebRTC): chat history
//
// Realtime auth:
//   We configure an `accessToken` callback on the Realtime client so that
//   every new WebSocket connection and every reconnect ships the
//   current user's JWT. The callback is invoked by Realtime whenever it
//   needs a fresh token (initial connect, reconnect, refresh). We pull
//   it from the same Supabase client via `auth.getSession()` — the
//   Supabase JS client transparently refreshes the session, so this
//   stays correct across token rotations.

import { createClient, RealtimeChannel } from '@supabase/supabase-js';

const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL ?? 'http://localhost:54321';
const SUPABASE_ANON_KEY =
  (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? 'public-anon-key';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    // Slightly more aggressive params so the WebRTC handshake feels snappy.
    params: { eventsPerSecond: 100 },
    // Token getter. Realtime calls this on every (re)connect, and the
    // Supabase Auth layer refreshes the session behind the scenes, so
    // we always return a non-expired token.
    //
    // Explicit return type breaks a TS inference cycle: the callback
    // references `supabase` (still being initialized) and TS would
    // otherwise widen it to `any`.
    accessToken: async (): Promise<string | null> => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
  },
});

// One channel per room. Channel name is the room id, prefixed with `room:`.
// `self: false` on broadcast means we do NOT receive our own messages back,
// which simplifies the WebRTC hook.
//
// Presence key:
//   We use the caller's user id, NOT a fresh random uuid per channel.
//   With a random key, a brief network blip that triggers a re-subscribe
//   gets a brand-new key — the stale row from the previous key lingers
//   server-side until its heartbeat expires, and the dedup pass on the
//   receiver counts both as separate participants. Keying on user id
//   means a reconnect collapses back to a single row in place. We still
//   add a small ":<random>" suffix so the same user in two tabs counts
//   as two presence rows (each tab needs its own).
export function roomChannel(roomId: string, presenceKey: string): RealtimeChannel {
  return supabase.channel(`room:${roomId}`, {
    config: {
      broadcast: { ack: false, self: false },
      presence: { key: presenceKey },
    },
  });
}
