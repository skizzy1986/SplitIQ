import { useEffect, useMemo } from 'react';
import { useStravaActivity } from './useStravaActivity.js';
import { seriesFromStrava } from '../utils/stravaSeries.js';
import { sessionSport } from '../utils/sessionPage.js';
import { isCompletedStatus } from '../utils/sessionStatus.js';
import { captureError } from '../utils/sentry.js';

const noop = () => {};

// What each `strava-activity` status means to the page.
const STRAVA_UNAVAILABLE = {
  not_connected: 'not_connected',
  auth_failed: 'auth_failed',
  gone: 'gone',
  garmin_attribution_pending: 'attribution_pending',
  rate_limited: 'rate_limited',
};

// The source picker: the page asks this hook for a session's series and never
// calls a source's hook itself. Returns
//   { state, reason, source, series, retryAt, refetch }
// state: 'none' (no series source for this session) | 'loading' | 'ready' |
//        'unavailable' (with reason) | 'error'.
//
// One branch today, Strava. Data the app captures itself (the PM5 now, other
// devices later) becomes a branch IN FRONT of it, preferred when both exist:
// it is the athlete's own, held for good, where a Strava trace is only cached.
export function useSessionSeries(session) {
  const sport = sessionSport(session?.type);
  const stravaEligible =
    !!session &&
    isCompletedStatus(session.status) &&
    !!sport &&
    session.strava_activity_id != null;

  const strava = useStravaActivity(session?.id, { enabled: stravaEligible });
  const body = stravaEligible ? strava.data : undefined;

  const built = useMemo(() => {
    if (body?.status !== 'ok') return { series: null, error: null };
    try {
      return { series: seriesFromStrava(body), error: null };
    } catch (error) {
      return { series: null, error };
    }
  }, [body]);

  useEffect(() => {
    if (built.error) captureError(built.error, { stage: 'session-series' });
  }, [built.error]);

  const { refetch } = strava;
  return useMemo(() => {
    const result = (state, extra = {}) => ({
      state,
      reason: null,
      source: null,
      series: null,
      retryAt: null,
      refetch: noop,
      ...extra,
    });
    if (!stravaEligible) return result('none');
    const retry = () => refetch();
    if (strava.isError)
      return result('error', { source: 'strava', refetch: retry });
    if (!body) return result('loading', { source: 'strava' });
    if (body.status === 'not_linked') return result('none');
    if (body.status === 'ok') {
      if (built.error) {
        return result('error', { source: 'strava', refetch: retry });
      }
      return built.series
        ? result('ready', { source: 'strava', series: built.series })
        : result('none', { source: 'strava' });
    }
    const reason = STRAVA_UNAVAILABLE[body.status];
    if (reason) {
      return result('unavailable', {
        source: 'strava',
        reason,
        retryAt:
          body.status === 'rate_limited' ? (body.retry_at ?? null) : null,
        refetch: retry,
      });
    }
    // upstream_error: Strava failed for a reason the page cannot name.
    return result('error', { source: 'strava', refetch: retry });
  }, [stravaEligible, strava.isError, body, built, refetch]);
}
