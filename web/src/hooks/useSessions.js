import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient.js';
import { toISODate } from '../utils/dateFormat.js';
import { useSessionOwner } from './useSessionOwner.js';

const FIELDS =
  'id, user_id, date, date_iso, type, label, duration, srpe, prs, exercises, coach_note, status, distance_m, avg_watts, avg_hr';
const PAGE_SIZE = 500;

export function useSessions({ mode = 'recent', subjectId } = {}) {
  const actorId = useSessionOwner();
  const ownerId = subjectId ?? actorId;
  // This release is self-use only. Explicit subjects prepare the query boundary;
  // they do not enable coach access or substitute for database RLS.
  const canRead =
    !!actorId && ownerId === actorId && ['recent', 'all'].includes(mode);
  return useQuery({
    queryKey: ['sessions', actorId, ownerId, mode],
    enabled: canRead,
    queryFn: async ({ signal }) => {
      // enabled:false does not block a caller's manual refetch (React Query).
      if (!canRead) return [];
      const rows = [];
      let offset = 0;
      while (true) {
        let query = supabase
          .from('sessions')
          .select(FIELDS, mode === 'all' ? { count: 'exact' } : undefined)
          .eq('user_id', ownerId)
          .order('date_iso', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false });
        query =
          mode === 'all'
            ? query.range(offset, offset + PAGE_SIZE - 1)
            : query.limit(50);
        const { data, error, count } = await query.abortSignal(signal);
        if (error) throw error;
        const page = data ?? [];
        rows.push(...page);
        offset += page.length;
        // Exact count also handles installations whose server cap is below 500.
        if (
          mode !== 'all' ||
          !page.length ||
          (count != null ? offset >= count : page.length < PAGE_SIZE)
        )
          break;
      }
      // Keep server tie order (id descending), including across page boundaries.
      // Date-text fallback covers schema-cache/deploy skew without mutating cache input.
      return rows.sort((a, b) => {
        const ai = a.date_iso ?? toISODate(a.date);
        const bi = b.date_iso ?? toISODate(b.date);
        return ai < bi ? 1 : ai > bi ? -1 : 0;
      });
    },
    staleTime: 60_000,
  });
}
