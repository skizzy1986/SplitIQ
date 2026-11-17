import { createSeries } from './sessionSeries.js';
import { httpsUrlOrNull } from './sessionPage.js';

// The one adapter from the `strava-activity` response (the frozen contract in
// PR 1a) to the source-neutral series. It is the only util that knows
// Strava's field names; the page and every calculation read the series.
//
// Returns null when the response carries no streams (Strava answered, but the
// activity has no trace): the page then shows the summary alone.
export function seriesFromStrava(body) {
  const streams = body?.streams ?? null;
  if (!streams || !Array.isArray(streams.time) || !streams.time.length) {
    return null;
  }
  const activity = body.activity ?? {};
  // Estimated watts are not measured power; the backend already nulls them,
  // and this keeps that true if the payload ever disagrees.
  const watts = activity.device_watts === false ? null : streams.watts;
  return createSeries({
    source: 'strava',
    sampling: 'time',
    t: streams.time,
    channels: {
      watts: watts ?? null,
      hr: streams.heartrate ?? null,
      rate: streams.cadence ?? null,
      dist: streams.distance ?? null,
      speed: streams.velocity_smooth ?? null,
      moving: streams.moving ?? null,
    },
    laps: (activity.laps ?? []).map((lap) => ({
      i0: lap.start_index,
      i1: lap.end_index,
      elapsedS: lap.elapsed_time_s,
      movingS: lap.moving_time_s,
      distanceM: lap.distance_m,
    })),
    info: {
      elapsedS: activity.elapsed_time_s ?? null,
      movingS: activity.moving_time_s ?? null,
      distanceM: activity.distance_m ?? null,
      elevationGainM: activity.total_elevation_gain_m ?? null,
      calories: activity.calories ?? null,
      device: activity.device_name ?? null,
      origin: body.origin ?? null,
      ref:
        body.strava_activity_id != null
          ? String(body.strava_activity_id)
          : null,
      // The activity page link, built by the edge function so the browser
      // never holds the host. Kept only when it is a well-formed https URL.
      href: httpsUrlOrNull(body.url),
      fetchedAt: body.fetched_at ?? null,
    },
  });
}
