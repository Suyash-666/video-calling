// lib/inviteLink.ts
// Single source of truth for the app's invite-link format.
//
// Format: {origin}/#/join/{roomId}/{token}
//   - Hash-based so it works without a router rewrite (no Vercel 404).
//   - Two path-style segments so a single paste carries both pieces.
//   - encodeURIComponent in case a room id ever contains '/' (today
//     it can't — base36 only — but cheap to be safe).
//
// Both build and parse are pure: the same input always produces the
// same output, and unparseable strings just return null. The Lobby
// uses parse() to recognize when the user lands on an invite URL.

export interface InviteParts {
  roomId: string;
  token: string;
}

const PREFIX = '#/join/';

export function buildInviteLink(roomId: string, token: string): string {
  // window.location.origin is the canonical app URL — works in dev and
  // in production deploys. Falls back to '' on the off chance this is
  // ever called server-side.
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  return `${origin}/${PREFIX}${encodeURIComponent(roomId)}/${encodeURIComponent(
    token
  )}`;
}

// Accepts a full URL, a hash fragment ("#/join/..."), or just the path
// portion ("join/<room>/<token>"). Returns null on anything else.
export function parseInviteLink(raw: string): InviteParts | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Pull the hash out if a full URL was pasted.
  let frag = trimmed;
  try {
    // Throws for non-URLs; that's fine, we fall through.
    const u = new URL(trimmed);
    frag = u.hash || u.pathname + u.hash;
  } catch {
    /* not a full URL */
  }

  // Strip leading '#' and any leading '/'.
  frag = frag.replace(/^#/, '').replace(/^\/+/, '');
  // Strip the 'join/' prefix if present so the same code handles both
  // "#/join/foo/bar" and a bare "foo/bar" paste.
  frag = frag.replace(/^join\//, '');

  const parts = frag.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  try {
    const roomId = decodeURIComponent(parts[0]);
    const token = decodeURIComponent(parts.slice(1).join('/'));
    if (!roomId || !token) return null;
    return { roomId, token };
  } catch {
    return null;
  }
}

// Convenience: read the *current* URL's hash and try to parse it.
// Returns null if the page wasn't opened with an invite link.
export function readInviteFromUrl(): InviteParts | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash || !hash.startsWith(PREFIX)) return null;
  return parseInviteLink(hash);
}

// After we've consumed an invite link, strip it from the URL bar so a
// browser refresh doesn't try to join again. Uses replaceState so the
// back button isn't polluted.
export function clearInviteFromUrl(): void {
  if (typeof window === 'undefined') return;
  if (!window.location.hash.startsWith(PREFIX)) return;
  const u = new URL(window.location.href);
  u.hash = '';
  window.history.replaceState({}, '', u.toString());
}
