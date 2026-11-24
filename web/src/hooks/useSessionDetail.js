import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient.js';
import { useSessionOwner } from './useSessionOwner.js';

// useSessions' fields, plus where the row came from and the Strava activity it
// is linked to (the series picker reads it; the page never shows it).
const FIELDS =
  'id, user_id, date, date_iso, type, label, duration, duration_min, srpe, prs, exercises, coach_note, status, distance_m, avg_watts, avg_hr, source, strava_activity_id';

// One session row. Keyed under ['sessions', …] so invalidateSessionQueries
// refreshes it with every other sessions read. RLS turns another user's id
// into no row, which the page shows as not found.
export function useSessionDetail(sessionId, { subjectId } = {}) {
  const actorId = useSessionOwner();
  const ownerId = subjectId ?? actorId;
  const validId = Number.isSafeInteger(sessionId) && sessionId > 0;
  const canRead = !!actorId && ownerId === actorId && validId;
  return useQuery({
    queryKey: ['sessions', actorId, ownerId, 'detail', sessionId],
    enabled: canRead,
    queryFn: async ({ signal }) => {
      if (!canRead) return null;
      const { data, error } = await supabase
        .from('sessions')
        .select(FIELDS)
        .eq('id', sessionId)
        .eq('user_id', ownerId)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    staleTime: 60_000,
  });
}
