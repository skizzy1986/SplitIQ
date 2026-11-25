// Write the tester's own rowing CP into anchors (#797). The current row for
// that key is superseded, then a new current row is inserted, so history is
// kept. RLS already limits the write to the signed-in user.
import { supabase } from '../supabaseClient.js';
import { parseRowingCp } from './firstRunGuide.js';

// anchors_status_check (006) accepts 'provisional', 'unvalidated' and
// 'confirmed'. A number the tester types, with no test behind it, is
// 'unvalidated'; #812's 200 W placeholder is 'provisional'.
export const TESTER_CP_STATUS = 'unvalidated';

export async function setRowingCp(raw) {
  const watts = parseRowingCp(raw);
  if (watts == null) return { ok: false, cause: 'invalid' };

  const { data: current, error: readError } = await supabase
    .from('anchors')
    .select('id')
    .eq('key', 'rowing_cp')
    .is('superseded_at', null)
    .maybeSingle();
  if (readError) return { ok: false, cause: 'error' };

  // anchors_one_live_per_key allows one live row per key, so the old row has to
  // be superseded before the new one goes in. Two requests, not one
  // transaction: if the insert fails, the old row is made live again, so a
  // failed save never leaves the tester with no CP.
  if (current?.id) {
    const { error } = await supabase
      .from('anchors')
      .update({ superseded_at: new Date().toISOString() })
      .eq('id', current.id);
    if (error) return { ok: false, cause: 'error' };
  }

  const { error } = await supabase.from('anchors').insert({
    key: 'rowing_cp',
    value: String(watts),
    unit: 'W',
    status: TESTER_CP_STATUS,
    source: 'tester',
  });
  if (error) {
    if (current?.id) {
      await supabase
        .from('anchors')
        .update({ superseded_at: null })
        .eq('id', current.id);
    }
    return { ok: false, cause: 'error' };
  }
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
