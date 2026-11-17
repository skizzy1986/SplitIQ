import { renderHook } from '@testing-library/react';
import { ergRow, stravaOkBody } from '../../test/sessionFixtures.js';

const strava = vi.fn();
vi.mock('../useStravaActivity.js', () => ({
  useStravaActivity: (...a) => strava(...a),
}));
const captureError = vi.fn();
vi.mock('../../utils/sentry.js', () => ({
  captureError: (...a) => captureError(...a),
}));

import { useSessionSeries } from '../useSessionSeries.js';

const query = (over = {}) => ({
  data: undefined,
  isError: false,
  refetch: vi.fn(),
  ...over,
});

const run = (session) => renderHook(() => useSessionSeries(session)).result;

beforeEach(() => {
  strava.mockReset();
  captureError.mockReset();
});

describe('useSessionSeries', () => {
  it('is none, and asks no source, for a session with no series source', () => {
    strava.mockReturnValue(query());
    for (const session of [
      null,
      ergRow({ strava_activity_id: null }),
      ergRow({ status: 'planned' }),
      ergRow({ type: 'strength' }),
    ]) {
      const r = run(session);
      expect(r.current.state).toBe('none');
      expect(r.current.series).toBeNull();
    }
    for (const call of strava.mock.calls) {
      expect(call[1]).toEqual({ enabled: false });
    }
  });

  it('reads a linked rowing or cycling session through the Strava adapter', () => {
    strava.mockReturnValue(query({ data: stravaOkBody({ n: 20 }) }));
    const r = run(ergRow());
    expect(strava).toHaveBeenCalledWith(4242, { enabled: true });
    expect(r.current.state).toBe('ready');
    expect(r.current.source).toBe('strava');
    expect(r.current.series.n).toBe(20);
    expect(r.current.series.source).toBe('strava');
    expect(run(ergRow({ type: 'ride' })).current.state).toBe('ready');
  });

  it('is loading while the answer is pending', () => {
    strava.mockReturnValue(query());
    expect(run(ergRow()).current.state).toBe('loading');
  });

  it('maps not_linked and an ok without streams to none', () => {
    strava.mockReturnValue(query({ data: { status: 'not_linked' } }));
    expect(run(ergRow()).current).toMatchObject({
      state: 'none',
      reason: null,
      source: null,
    });
    // An answer with no streams: the activity exists and holds no trace.
    strava.mockReturnValue(
      query({ data: { ...stravaOkBody(), streams: null } })
    );
    expect(run(ergRow()).current).toMatchObject({
      state: 'none',
      reason: 'no_trace',
      source: 'strava',
    });
  });

  it.each([
    ['not_connected', 'not_connected'],
    ['auth_failed', 'auth_failed'],
    ['gone', 'gone'],
    ['garmin_attribution_pending', 'attribution_pending'],
  ])('maps %s to unavailable(%s)', (status, reason) => {
    strava.mockReturnValue(query({ data: { status } }));
    const r = run(ergRow());
    expect(r.current).toMatchObject({ state: 'unavailable', reason });
  });

  it('carries the retry time when rate limited', () => {
    strava.mockReturnValue(
      query({
        data: { status: 'rate_limited', retry_at: '2026-11-10T09:15:00Z' },
      })
    );
    expect(run(ergRow()).current).toMatchObject({
      state: 'unavailable',
      reason: 'rate_limited',
      retryAt: '2026-11-10T09:15:00Z',
    });
  });

  it('is error on a failed call, an upstream error, or a malformed series', () => {
    const refetch = vi.fn();
    strava.mockReturnValue(query({ isError: true, refetch }));
    const r = run(ergRow());
    expect(r.current.state).toBe('error');
    r.current.refetch();
    expect(refetch).toHaveBeenCalled();

    strava.mockReturnValue(query({ data: { status: 'upstream_error' } }));
    expect(run(ergRow()).current.state).toBe('error');

    const bad = stravaOkBody({ n: 5 });
    bad.streams.watts = [1];
    strava.mockReturnValue(query({ data: bad }));
    expect(run(ergRow()).current.state).toBe('error');
    expect(captureError).toHaveBeenCalled();
  });
});
