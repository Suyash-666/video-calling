// components/AuthScreen.tsx
// Sign-in / sign-up screen. We use Supabase's email + password auth.
// If email confirmations are enabled in the dashboard, signUp will
// show a "check your email" message instead of auto-signing-in.

import { useState } from 'react';
import { useAuth } from '../lib/auth';

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
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <h1 className="text-center text-2xl font-semibold">Zoom Mini</h1>
      <p className="text-center text-sm text-slate-400">
        Sign in to create or join a 1:1 call.
      </p>

      <div className="grid grid-cols-2 rounded-lg bg-slate-800 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode('signin')}
          className={`rounded-md py-2 font-medium transition ${
            mode === 'signin' ? 'bg-slate-700 text-white' : 'text-slate-400'
          }`}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          className={`rounded-md py-2 font-medium transition ${
            mode === 'signup' ? 'bg-slate-700 text-white' : 'text-slate-400'
          }`}
        >
          Create account
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm outline-none focus:border-brand-500"
          autoFocus
        />
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password (min 6 chars)"
          className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      {error && <p className="text-center text-sm text-red-400">{error}</p>}
      {info && <p className="text-center text-sm text-emerald-400">{info}</p>}

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-center text-xs text-slate-500">
        Auth is required to keep rooms private. Two signed-in users in the
        same room = a call.
      </div>
    </div>
  );
}
