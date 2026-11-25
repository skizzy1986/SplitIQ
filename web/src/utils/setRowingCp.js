// Save the tester's own rowing CP (#797) through set_my_rowing_cp() from
// migration 025. The database retires the live rowing_cp row and inserts the
// new one ('W', 'unvalidated', 'tester') in one statement, so a save either
// lands whole or changes nothing, and two saves at once queue on a per-user
// lock. It runs as the signed-in user, so RLS limits it to their own rows.
// Needs 025 applied on the project this build talks to (dev only).
import { supabase } from '../supabaseClient.js';
import { parseRowingCp } from './firstRunGuide.js';

export async function setRowingCp(raw) {
  const watts = parseRowingCp(raw);
  if (watts == null) return { ok: false, cause: 'invalid' };

  const { data, error } = await supabase.rpc('set_my_rowing_cp', {
    p_watts: watts,
  });
  if (error || data?.status !== 'saved') return { ok: false, cause: 'error' };
  return { ok: true, watts };
}

// Clear the tester's sample data through #812's clear_my_sample_data(), which
// removes exactly what its ledger lists (sample sessions, workouts and their
// sets, the placeholder CP) and the ledger rows, for the signed-in tester only.
// count is the number of sample sessions removed.
export async function clearSampleData() {
  const { data, error } = await supabase.rpc('clear_my_sample_data');
  if (error) return { ok: false, cause: 'error' };
  return { ok: true, count: data?.sessions ?? 0 };
}
