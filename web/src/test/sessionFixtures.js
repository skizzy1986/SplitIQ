// Synthetic fixtures for the session page tests. Every id and number is
// invented; none comes from a real session or a real Strava activity.
import { createSeries } from '../utils/sessionSeries.js';
import { seriesFromStrava } from '../utils/stravaSeries.js';

// Everything a reader or a screen reader gets from a rendered page: the text
// and every aria-label.
export const spoken = (container) =>
  [
    container.textContent,
    ...[...container.querySelectorAll('[aria-label]')].map((el) =>
      el.getAttribute('aria-label')
    ),
  ].join(' ');

// Every trace state useSessionSeries can hand the page.
export function traceStates() {
  return [
    {
      state: 'ready',
      series: seriesFromStrava(stravaOkBody()),
      source: 'strava',
    },
    { state: 'loading', source: 'strava' },
    { state: 'none' },
    { state: 'none', source: 'strava', reason: 'no_trace' },
    ...[
      'not_connected',
      'auth_failed',
      'rate_limited',
      'gone',
      'attribution_pending',
    ].map((reason) => ({ state: 'unavailable', source: 'strava', reason })),
    { state: 'error', source: 'strava' },
  ].map((s) => ({
    reason: null,
    source: null,
    series: null,
    retryAt: null,
    refetch: () => {},
    ...s,
  }));
}

// A source that is not Strava, sampled per stroke at irregular times, with a
// channel the model does not know about (driveLength).
export const captureSeries = () =>
  createSeries({
    source: 'capture',
    sampling: 'stroke',
    t: [0, 2.4, 4.9, 7.1, 9.8, 12.0, 30.0, 32.5],
    channels: {
      watts: [180, 200, 220, 210, 190, 0, 200, 205],
      hr: [130, 132, 0, 136, 138, 139, 140, 141],
      rate: [24, 25, 25, 24, 24, 0, 26, 26],
      dist: [0, 10, 20, 30, 40, 50, 55, 65],
      driveLength: [1.4, 1.42, 1.41, 1.43, 1.4, 1.39, 1.41, 1.42],
    },
  });

// A completed erg session row as useSessionDetail returns it.
export const ergRow = (over = {}) => ({
  id: 4242,
  user_id: 'u-test',
  date: '11/10/26',
  date_iso: '2026-11-10',
  type: 'erg',
  label: 'Steady row',
  duration: '30:00',
  srpe: 5,
  status: 'completed',
  distance_m: 7200,
  avg_watts: 180,
  avg_hr: 140,
  source: 'strava',
  strava_activity_id: 987654,
  ...over,
});

export const ACTIVITY_URL = 'https://activities.example.test/987654';

// A `strava-activity` ok response (PR 1a's frozen contract), 30 minutes at
// 1 Hz. Synthetic.
export function stravaOkBody({
  n = 1800,
  watts = true,
  hr = true,
  cadence = true,
  origin = 'inserted',
} = {}) {
  const time = Array.from({ length: n }, (_, i) => i);
  return {
    status: 'ok',
    cached: false,
    origin,
    strava_activity_id: 987654,
    // Synthetic: the real function builds this on the server. A placeholder
    // host keeps the source-provider's host out of src/ entirely.
    url: ACTIVITY_URL,
    fetched_at: '2026-11-10T08:00:00Z',
    expires_at: '2026-11-16T08:00:00Z',
    activity: {
      sport_type: 'Rowing',
      device_name: 'Test Monitor',
      elapsed_time_s: n,
      moving_time_s: n,
      distance_m: n * 4,
      total_elevation_gain_m: 0,
      calories: 300,
      device_watts: watts,
      laps: [
        {
          start_index: 0,
          end_index: n - 1,
          elapsed_time_s: n,
          moving_time_s: n,
          distance_m: n * 4,
        },
      ],
    },
    streams: {
      time,
      distance: time.map((i) => i * 4),
      watts: watts ? time.map((i) => (i % 600 < 300 ? 170 : 190)) : null,
      heartrate: hr ? time.map((i) => 130 + Math.floor(i / 120)) : null,
      cadence: cadence ? time.map(() => 22) : null,
      velocity_smooth: time.map(() => 4),
      // Numbers, as the function sends them, with one paused sample just
      // before the middle (when there is one). At the default length that
      // leaves 899 s at 170 W and 899 s at 190 W, so no zone holds most.
      moving: time.map((i) => (n > 2 && i === Math.floor(n / 2) - 1 ? 0 : 1)),
    },
  };
}
