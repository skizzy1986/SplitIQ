import { useQuery } from '@tanstack/react-query';
import { supabase } from '../supabaseClient.js';
import { useSessionOwner } from './useSessionOwner.js';

// Every status the `strava-activity` function answers with (PR 1a's frozen
// contract). Anything else is a contract break and throws.
export const STRAVA_ACTIVITY_STATUSES = [
  'ok',
  'not_linked',
  'not_connected',
  'auth_failed',
  'gone',
  'garmin_attribution_pending',
  'upstream_error',
  'rate_limited',
];

const HALF_HOUR = 30 * 60_000;

export const staleTimeFor = (query) =>
  query.state.data?.status === 'ok' ? HALF_HOUR : 0;

// One activity's trace through the edge function. Called only by
// useSessionSeries. Held in memory only (react-query's cache, never
// persisted): Strava data may sit in the server's cache, not the browser's.
export function useStravaActivity(sessionId, { enabled = true } = {}) {
  const actorId = useSessionOwner();
  const validId = Number.isSafeInteger(sessionId) && sessionId > 0;
  return useQuery({
    queryKey: ['strava', 'activity', actorId, sessionId],
    enabled: enabled && !!actorId && validId,
    queryFn: async ({ signal }) => {
      // functions.invoke takes an AbortSignal (Context7 /supabase/supabase-js,
      // FunctionInvokeOptions.signal), so leaving the page cancels the fetch.
      const { data, error } = await supabase.functions.invoke(
        'strava-activity',
        { body: { session_id: sessionId }, signal }
      );
      if (error) throw error;
      if (!data || !STRAVA_ACTIVITY_STATUSES.includes(data.status)) {
        throw new Error('strava-activity: unexpected response status');
      }
      return data;
    },
    // The app default retries; a retry here would spend Strava quota.
    retry: false,
    // Only a trace is worth holding. Any other answer (not connected, rate
    // limited, gone) is stale at once, so reopening the page asks again.
    // staleTime may be a function of the query (Context7 /tanstack/query,
    // StaleTimeFunction).
    staleTime: staleTimeFor,
    gcTime: HALF_HOUR,
    refetchOnWindowFocus: false,
  });
}
