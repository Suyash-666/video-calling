// components/AuthScreen.tsx
//
// The first thing a user sees. Designed to feel like the cover of
// a software company's homepage, not a login form.
//
// Layout: a 5/12 left rail with the brand statement in display type,
// and a 7/12 right pane with the form. The left rail carries a slow
// vertical ambient gradient (defined in index.css) so the page is
// not static, but is also not animated in a way that demands
// attention. The form has no card, no border, no rounded corners —
// it is just typography resting on the page field. Inputs are
// borderless with an underline that animates to amber on focus.
// The primary action is a text link with an animated underline; we
// deliberately avoid the "big blue button" pattern that dominates
// the rest of the SaaS world.
//
// Why split-screen and not centered: a centered card is a login
// form. A split panel is an editorial cover. The user sees a
// statement first and an action second, which is the order the
// rest of the product follows (the lobby leads with the page title
// in display type, not with a card of inputs).

import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { ArrowRightIcon } from './Icons';

type Mode = 'signin' | 'signup';

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const fn = mode === 'signin' ? signIn : signUp;
      const { error: msg } = await fn(email.trim(), password);
      if (msg) setError(msg);
      else if (mode === 'signup')
        setInfo('Check your email to confirm the account, then sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    // The page is a single horizontal split on desktop, stacking
    // on mobile (the left rail collapses behind the form). We use
    // a CSS grid rather than flex so the columns are exactly 5/12
    // and 7/12 — flex would let the form's content stretch the
    // right column wider.
    <div className="grid min-h-screen w-full grid-cols-1 md:grid-cols-12">
      {/* ----------------------------------------------------------------
          LEFT RAIL — the brand statement
          ---------------------------------------------------------------- */}
      <aside
        className="ambient-veil noise-overlay relative hidden
                   md:col-span-5 md:flex md:flex-col md:justify-between
                   p-12 lg:p-16"
      >
        {/* Top: wordmark. Letter-spaced caps in mono so it reads
            as a system identifier, not a logo. */}
        <div className="flex items-center gap-2 font-mono text-small
                        tracking-[0.18em] text-ink-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          ZOOM&nbsp;MINI
        </div>

        {/* Center: the statement. The headline sets the tone; the
            subhead grounds it in product. Both use the display
            scale. We deliberately don't use a button or a CTA on
            the left — the form on the right is the only action. */}
        <div className="max-w-md">
          <p className="micro-label mb-6 text-ink-500">A CALLING TOOL</p>
          <h1 className="display-lg text-ink-50">
            Quiet video.
            <br />
            Considered by default.
          </h1>
          <p className="mt-8 max-w-sm text-body leading-relaxed text-ink-400">
            One-to-one rooms with end-to-end encrypted signaling, a
            single window, and the controls you'd actually use. Nothing
            else.
          </p>
        </div>

        {/* Bottom: a small set of "principles" in micro type. Three
            lines, no bullets. Reads as a manifesto, not a feature
            list. */}
        <ul className="space-y-2 font-mono text-micro uppercase
                       tracking-[0.12em] text-ink-500">
          <li>— No recording by default</li>
          <li>— No analytics, no third parties</li>
          <li>— Your room, your room id</li>
        </ul>
      </aside>

      {/* ----------------------------------------------------------------
          RIGHT PANE — the form
          ---------------------------------------------------------------- */}
      <main className="col-span-1 flex flex-col md:col-span-7">
        {/* Mobile wordmark. On desktop the brand lives in the left
            rail, so this is hidden. */}
        <div className="flex items-center gap-2 p-8 font-mono
                        text-small tracking-[0.18em] text-ink-400
                        md:hidden">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          ZOOM&nbsp;MINI
        </div>

        {/* The form is anchored to the right on desktop, with the
            same p-12/p-16 padding as the left rail so the two
            columns feel paired. The form itself is narrow (~360px)
            so the user reads a single column. */}
        <div className="flex flex-1 items-center px-8 pb-12 pt-4
                        md:px-16 md:py-16">
          <div className="w-full max-w-sm">
            {/* Mode toggle as a text pair, not a segmented control.
                The active mode is white with an amber underline;
                the inactive mode is ink-500. No background, no
                rounded container. */}
            <div className="mb-12 flex items-baseline gap-6">
              {(['signin', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`relative pb-1 text-body font-medium
                              outline-none transition-colors
                              duration-180 ease-out
                              ${
                                mode === m
                                  ? 'text-ink-50'
                                  : 'text-ink-500 hover:text-ink-200'
                              }`}
                >
                  {m === 'signin' ? 'Sign in' : 'Create account'}
                  {/* The amber underline is only rendered on the
                      active mode. We transition opacity so the
                      swap between modes is animated. */}
                  <span
                    className={`absolute -bottom-px left-0 right-0
                                h-px bg-accent transition-opacity
                                duration-180 ease-out
                                ${mode === m ? 'opacity-100' : 'opacity-0'}`}
                  />
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="flex flex-col gap-8">
              {/* Email. The single-line layout uses borderless
                  inputs with an animated bottom border. The label
                  sits above in micro type so screen readers
                  announce it and the visual hierarchy is clear. */}
              <label className="block">
                <span className="micro-label">EMAIL</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-bare mt-2"
                  autoFocus
                />
              </label>

              <label className="block">
                <span className="micro-label">PASSWORD</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={
                    mode === 'signin' ? 'current-password' : 'new-password'
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-bare mt-2"
                />
              </label>

              {/* Error and info messages. We keep them out of the
                  form's vertical rhythm (mt-6) so the layout
                  doesn't reflow when an error appears. */}
              <div className="min-h-[1.25rem] mt-2">
                {error && (
                  <p className="text-small text-state-error">{error}</p>
                )}
                {info && (
                  <p className="text-small text-state-success">{info}</p>
                )}
              </div>

              {/* Primary action. Text link with animated underline.
                  The disabled state is rendered when busy; we keep
                  the link visible (rather than swapping to a
                  spinner) because the action takes under a second
                  and a spinner would feel heavier than the moment
                  deserves. */}
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="submit"
                  disabled={busy}
                  aria-disabled={busy}
                  className="action-primary"
                >
                  {busy
                    ? 'Working…'
                    : mode === 'signin'
                      ? 'Sign in'
                      : 'Create account'}
                  <ArrowRightIcon size={14} className="opacity-60" />
                </button>

                {/* The "forgot password" link is intentionally not
                    here yet — Supabase reset is wired in
                    lib/auth.ts and we can drop it in next pass. */}
              </div>
            </form>

            {/* Privacy note. Quiet micro-type at the bottom of the
                form column. Replaces the previous "Auth is
                required…" block; reads as a statement rather than
                a tip. */}
            <p className="mt-16 max-w-xs text-small leading-relaxed
                        text-ink-500">
              Auth keeps rooms private. Two signed-in users in the
              same room — that's the call.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
