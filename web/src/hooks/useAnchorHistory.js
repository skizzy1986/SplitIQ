import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient.js';

// Columns 028 adds; a project without 028 (production today) answers 42703 or
// PGRST204 for them, and the history reads as unavailable instead of failing.
const ABSENT_CODES = new Set(['42P01', '42703', 'PGRST205', 'PGRST204']);

const COLUMNS =
  'id, key, value, unit, status, source, valid_from, superseded_at, created_at, reason, rule_id, rule_version, provenance, locked';

export const anchorHistoryKey = (key) => ['anchorHistory', key];

// Every row of one anchor key for the signed-in user (#819 S4, A 44): the live
// row and the retired ones, newest valid_from first, ties to the latest
// created_at ("valid on date D" order). RLS (anchors_owner) limits the rows to
// the caller, so there is no user_id filter. Reads only; nothing here writes.
export function useAnchorHistory(key, { enabled = true } = {}) {
  const query = useQuery({
    queryKey: anchorHistoryKey(key),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('anchors')
        .select(COLUMNS)
        .eq('key', key)
        .order('valid_from', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) {
        if (ABSENT_CODES.has(error.code)) return { available: false, rows: [] };
        throw error;
      }
      return { available: true, rows: data ?? [] };
    },
    staleTime: 60_000,
  });

  const result = query.data ?? { available: false, rows: [] };
  const live = result.rows.find((r) => r.superseded_at == null) ?? null;
  const retired = result.rows.filter((r) => r.superseded_at != null);
  return {
    ...query,
    loaded: query.isSuccess,
    available: result.available,
    live,
    retired,
  };
}
