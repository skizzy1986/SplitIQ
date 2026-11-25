// Write the tester's own rowing CP into anchors (#797). The current row for
// that key is superseded, then a new current row is inserted, so history is
// kept. RLS already limits the write to the signed-in user.
import { supabase } from '../supabaseClient.js';
import { parseRowingCp } from './firstRunGuide.js';

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
    status: 'set',
    source: 'tester',
  });
  if (error) return { ok: false, cause: 'error' };
  return { ok: true, watts };
}

export async function clearSampleSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .delete()
    .eq('source', 'sample')
    .select('id');
  if (error) return { ok: false, cause: 'error' };
  return { ok: true, count: (data ?? []).length };
}
