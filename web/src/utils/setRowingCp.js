// Save the user's own rowing CP (#819 S4) through save_my_cp() from migration
// 028. The database retires the live rowing_cp row and inserts the new one in
// one step, behind a per-user lock, so a save either lands whole or changes
// nothing. It runs as the signed-in user, so RLS limits it to their own rows.
// A CP typed in Settings is source 'manual', status 'unvalidated', reason
// 'manual' (H 38). Needs 028 on the project this build talks to (dev only).
import { supabase } from '../supabaseClient.js';
import { parseRowingCp } from './firstRunGuide.js';
import { captureError } from './sentry.js';
import { localIsoDate } from './trainingSettings.js';

// What a failed save reports: the call, never the watts.
const SAVE_CONTEXT = { where: 'setRowingCp', rpc: 'save_my_cp' };

// expectedLiveId is the id of the live rowing_cp row the user was looking at.
// If another device has saved since, the database answers 'stale' and writes
// nothing, so two devices never stack two changes (A 32).
export async function setRowingCp(raw, { expectedLiveId = null } = {}) {
  const watts = parseRowingCp(raw);
  if (watts == null) return { ok: false, cause: 'invalid' };

  const { data, error } = await supabase.rpc('save_my_cp', {
    p_watts: watts,
    p_source: 'manual',
    p_status: 'unvalidated',
    p_reason: 'manual',
    p_valid_from: localIsoDate(),
    p_rule_id: null,
    p_rule_version: null,
    p_provenance: null,
    p_expected_live_id: expectedLiveId,
    p_locked: null,
  });
  // Reported so a missing 028 (PGRST202) or a refused save shows up in
  // Sentry, not only as "Could not save that. Try again."
  if (error) {
    captureError(error, SAVE_CONTEXT);
    return { ok: false, cause: 'error' };
  }
  const status = data?.status;
  if (status === 'saved' || status === 'unchanged') return { ok: true, watts };
  if (status === 'stale') return { ok: false, cause: 'stale' };
  captureError(new Error('save_my_cp did not report saved'), SAVE_CONTEXT);
  return { ok: false, cause: 'error' };
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
