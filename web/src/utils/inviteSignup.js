// The request behind the invite sign-up form (#791). Kept apart from the
// component so the sequence is testable on its own: check the form, ask the
// invite-signup function to make the account, then sign in with it. It returns
// a cause key, never text; the form turns a key into words in the active
// language. Nothing here logs the code, the email or the password.
import { supabase } from '../supabaseClient.js';

export const MIN_PASSWORD = 8;

// The causes the form knows how to say. The first seven come back from the
// function; the rest are found here.
export const CAUSES = [
  'invalid',
  'weak_password',
  'consent_required',
  'rate_limited',
  'bad_request',
  'disabled',
  'server',
  'missing',
  'mismatch',
  'network',
];

export async function submitInviteSignup({
  email,
  password,
  confirm,
  code,
  consent,
}) {
  const trimmed = (email ?? '').trim();
  const cleanCode = (code ?? '').trim();
  if (!trimmed || !password || !confirm || !cleanCode) {
    return { ok: false, cause: 'missing' };
  }
  if (password !== confirm) return { ok: false, cause: 'mismatch' };
  if (password.length < MIN_PASSWORD) {
    return { ok: false, cause: 'weak_password' };
  }
  if (consent !== true) return { ok: false, cause: 'consent_required' };

  const { data, error } = await supabase.functions.invoke('invite-signup', {
    body: { email: trimmed, password, code: cleanCode, consent: true },
  });
  // A 2xx with { ok: false, error } is an answer. An error here (or an answer
  // that is not ours) is the function being unreachable or misbehaving.
  if (error || !data || typeof data.ok !== 'boolean') {
    return { ok: false, cause: 'network' };
  }
  if (!data.ok) {
    return {
      ok: false,
      cause: CAUSES.includes(data.error) ? data.error : 'server',
    };
  }

  // The account exists and is confirmed, so the password signs in at once.
  const signedIn = await supabase.auth.signInWithPassword({
    email: trimmed,
    password,
  });
  if (signedIn.error) return { ok: true, signedIn: false };
  return { ok: true, signedIn: true };
}
