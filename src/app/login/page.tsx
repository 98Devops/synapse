'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = supabaseBrowser();
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // With email confirmation on, there is no session yet.
        if (!data.session) {
          setNotice('Check your email to confirm the account, then sign in.');
          setMode('signin');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-5">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-[380px]"
      >
        <div className="mb-8 text-center">
          <div className="label mb-1">Second Brain</div>
          <h1 className="text-gradient text-[30px] font-extrabold tracking-tight">Synapse</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Speak a thought. Watch it find its place in everything else you know.
          </p>
        </div>

        <form onSubmit={submit} className="panel rounded-2xl p-5">
          <div className="mb-4 flex gap-1 rounded-xl bg-bg/50 p-1">
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`relative flex-1 rounded-lg px-3 py-2 text-[12px] font-medium transition ${
                  mode === m ? 'text-ink' : 'text-muted hover:text-ink/80'
                }`}
              >
                {mode === m && (
                  <motion.span
                    layoutId="auth-tab"
                    className="absolute inset-0 rounded-lg bg-accent-soft"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative">{m === 'signin' ? 'Sign in' : 'Create account'}</span>
              </button>
            ))}
          </div>

          <label className="label mb-1.5 block">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="focus-ring mb-3 w-full rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-[13px] outline-none transition placeholder:text-faint"
            placeholder="you@example.com"
          />

          <label className="label mb-1.5 block">Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            className="focus-ring w-full rounded-xl border border-line bg-bg/60 px-3 py-2.5 text-[13px] outline-none transition placeholder:text-faint"
            placeholder="At least 6 characters"
          />

          {error && <p className="mt-3 text-[12px] leading-relaxed text-rose">{error}</p>}
          {notice && <p className="mt-3 text-[12px] leading-relaxed text-green">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="glow mt-5 w-full rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">
          Your notes are private to your account and isolated at the database level.
        </p>
      </motion.div>
    </main>
  );
}
