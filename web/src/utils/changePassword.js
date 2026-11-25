// Change the signed-in tester's password (#792). Returns a cause key, never
// text; the panel turns it into words in the active language. The current
// password is checked first by signing in with it, so a phone left unlocked on
// the Settings screen cannot be used to lock the owner out. Nothing here logs
// or returns either password.
import { supabase } from '../supabaseClient.js';

export const MIN_PASSWORD = 8;

export async function changePassword({ current, next, confirm }) {
  if (!current || !next || !confirm) return { ok: false, cause: 'missing' };
  if (next !== confirm) return { ok: false, cause: 'mismatch' };
  if (next.length < MIN_PASSWORD) return { ok: false, cause: 'weak_password' };
  if (next === current) return { ok: false, cause: 'same' };

  const { data } = await supabase.auth.getSession();
  const email = data?.session?.user?.email;
  if (!email) return { ok: false, cause: 'session' };

  const check = await supabase.auth.signInWithPassword({
    email,
    password: current,
  });
  if (check.error) {
    return {
      ok: false,
      cause:
        check.error.code === 'invalid_credentials'
          ? 'wrong_current'
          : check.error.name === 'AuthRetryableFetchError'
            ? 'network'
            : 'failed',
    };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (!error) return { ok: true };
  if (error.code === 'weak_password')
    return { ok: false, cause: 'weak_password' };
  if (error.code === 'same_password') return { ok: false, cause: 'same' };
  if (error.name === 'AuthRetryableFetchError') {
    return { ok: false, cause: 'network' };
  }
  return { ok: false, cause: 'failed' };
}
