// components/ResetPassword.tsx
//
// Where the user lands after clicking the link in the password-reset
// email. The link from Supabase puts a one-time access token in the
// URL hash (e.g. /reset-password#access_token=...&type=recovery),
// and the Supabase JS client picks it up automatically — it detects
// the recovery flow, sets a recovery session, and is then ready to
// accept updateUser({ password }) calls.
//
// Layout mirrors AuthScreen on the right pane only: same micro
// labels, same borderless inputs, same amber-underlined primary
// action. We skip the left rail because the user is mid-flow and
// just wants to finish the reset.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ArrowRightIcon } from './Icons';

type State = 'checking' | 'ready' | 'invalid';

export function ResetPassword() {
  const [state, setState] = useState<State>('checking');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Supabase stores the recovery token in the URL hash. The
  // createClient() call above already wired up detectSessionInUrl,
  // so on the next auth-state change we'll either land with a
  // valid recovery session or with no session at all. We
  // subscribe once and read the result.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setState('ready');
        return;
      }
      // The Supabase client may also have already exchanged the
      // hash for a session by the time we get here. Treat any
      // active session that arrived via a recovery link as
      // ready, and any other state (no session) as invalid.
      if (session) {
        setState('ready');
      } else {
        setState((prev) => (prev === 'checking' ? 'invalid' : prev));
      }
    });
    // If the hash didn't trigger an event within a beat (older
    // SDKs, or the link was already exchanged), fall through
    // after a short delay so the user gets feedback either way.
    const t = setTimeout(() => {
      setState((prev) => (prev === 'checking' ? 'invalid' : prev));
    }, 1500);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(t);
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: msg } = await supabase.auth.updateUser({ password });
      if (msg) {
        setError(msg.message);
        return;
      }
      setDone(true);
      // Sign out the recovery session so the user lands on the
      // auth screen (not the lobby) when they navigate back to /.
      // We do this silently — no UI about it.
      await supabase.auth.signOut();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen w-full grid-cols-1 md:grid-cols-12">
      {/* Brand rail on the left, identical in tone to AuthScreen
          but without the "calling tool" headline — the user is
          mid-flow, not evaluating the product. */}
      <aside
        className="ambient-veil noise-overlay relative hidden
                   md:col-span-5 md:flex md:flex-col md:justify-between
                   p-12 lg:p-16"
      >
        <div className="flex items-center gap-2 font-mono text-small
                        tracking-[0.18em] text-ink-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          ZOOM&nbsp;MINI
        </div>
        <div className="max-w-md">
          <p className="micro-label mb-6 text-ink-500">PASSWORD RESET</p>
          <h1 className="display-lg text-ink-50">
            Pick a new
            <br />
            password.
          </h1>
          <p className="mt-8 max-w-sm text-body leading-relaxed text-ink-400">
            Use at least six characters. Once you set it, you'll be
            signed out and asked to sign in again.
          </p>
        </div>
        <ul className="space-y-2 font-mono text-micro uppercase
                       tracking-[0.12em] text-ink-500">
          <li>— The reset link is single-use</li>
          <li>— Links expire after one hour</li>
        </ul>
      </aside>

      <main className="col-span-1 flex flex-col md:col-span-7">
        <div className="flex items-center gap-2 p-8 font-mono
                        text-small tracking-[0.18em] text-ink-400
                        md:hidden">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          ZOOM&nbsp;MINI
        </div>

        <div className="flex flex-1 items-center px-8 pb-12 pt-4
                        md:px-16 md:py-16">
          <div className="w-full max-w-sm">
            {state === 'checking' && (
              <p className="text-small text-ink-500">
                Verifying your reset link…
              </p>
            )}

            {state === 'invalid' && (
              <>
                <p className="micro-label mb-6 text-ink-500">
                  LINK PROBLEM
                </p>
                <h2 className="display-md text-ink-50">
                  That link doesn't work.
                </h2>
                <p className="mt-6 text-body leading-relaxed text-ink-400">
                  Password-reset links are single-use and expire after
                  an hour. Request a new one from the sign-in screen.
                </p>
                <div className="mt-10">
                  <a
                    href="/"
                    className="action-primary"
                  >
                    Back to sign in
                    <ArrowRightIcon size={14} className="opacity-60" />
                  </a>
                </div>
              </>
            )}

            {state === 'ready' && !done && (
              <form onSubmit={submit} className="flex flex-col gap-8">
                <div>
                  <p className="micro-label mb-6 text-ink-500">
                    NEW PASSWORD
                  </p>
                  <h2 className="display-md text-ink-50">
                    Set a new password.
                  </h2>
                </div>

                <label className="block">
                  <span className="micro-label">PASSWORD</span>
                  <input
                    type="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-bare mt-2"
                  />
                </label>

                <div className="min-h-[1.25rem] mt-2">
                  {error && (
                    <p className="text-small text-state-error">{error}</p>
                  )}
                </div>

                <div className="mt-2">
                  <button
                    type="submit"
                    disabled={busy}
                    aria-disabled={busy}
                    className="action-primary"
                  >
                    {busy ? 'Working…' : 'Save new password'}
                    <ArrowRightIcon size={14} className="opacity-60" />
                  </button>
                </div>
              </form>
            )}

            {done && (
              <>
                <p className="micro-label mb-6 text-state-success">
                  PASSWORD UPDATED
                </p>
                <h2 className="display-md text-ink-50">
                  You're all set.
                </h2>
                <p className="mt-6 text-body leading-relaxed text-ink-400">
                  Sign in with your new password to continue.
                </p>
                <div className="mt-10">
                  <a
                    href="/"
                    className="action-primary"
                  >
                    Go to sign in
                    <ArrowRightIcon size={14} className="opacity-60" />
                  </a>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
