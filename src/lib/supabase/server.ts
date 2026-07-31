import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them to .env.'
    );
  }
  return { url, anon };
}

/**
 * Request-scoped client that carries the user's session cookie, so every query
 * runs as that user and row level security does the isolation for us.
 */
export async function supabaseServer() {
  const { url, anon } = publicConfig();
  const store = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component — middleware refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely, so it must never be handed a
 * user-supplied filter without an explicit user_id of our own choosing.
 */
export function supabaseAdmin() {
  const { url } = publicConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The signed-in user, or null. */
export async function currentUser() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Throws a 401-shaped error when there is no session. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    const err = new Error('Not signed in');
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  return user;
}
