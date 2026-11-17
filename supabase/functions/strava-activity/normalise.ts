// normalise.ts — Strava's activity detail and streams, reduced to the frozen
// `activity` and `streams` objects of strava-activity's response contract
// (#647). Pure: no I/O, no clock, no Supabase, so test.ts drives it directly.
//
// What is never copied, whatever Strava sends: name, description, map,
// start_latlng, end_latlng, segment_efforts, photos, athlete, gear. The output
// is built field by field from an allowlist, never by spreading the input, so a
// new field on Strava's side cannot leak into the cache.
import { hasDeviceWatts, type StravaActivity } from "../strava-import/mapper.ts";

/**
 * Six days, not seven: Strava API Policy §6.2 allows at most seven, and the
 * hourly sweep (migration 020) may run up to an hour after expiry. The table's
 * check constraint refuses anything past seven.
 */
export const CACHE_TTL_MS = 6 * 24 * 3600 * 1000;

export type Lap = {
  start_index: number | null;
  end_index: number | null;
  elapsed_time_s: number | null;
  moving_time_s: number | null;
  distance_m: number | null;
};

export type CachedActivity = {
  sport_type: string | null;
  device_name: string | null;
  elapsed_time_s: number | null;
  moving_time_s: number | null;
  distance_m: number | null;
  total_elevation_gain_m: number | null;
  calories: number | null;
  device_watts: boolean;
  laps: Lap[];
};

type Series = (number | null)[] | null;

export type CachedStreams = {
  time: Series;
  distance: Series;
  watts: Series;
  heartrate: Series;
  cadence: Series;
  velocity_smooth: Series;
  moving: Series;
};

export type CachedPayload = { activity: CachedActivity; streams: CachedStreams };

type RawStream = { data?: unknown; original_size?: unknown };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const oneDp = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n * 10) / 10;
};
const bit = (v: unknown): number | null => (v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : null);

/**
 * Streams keyed by type (what key_by_type=true answers) or an array of
 * {type, data, ...} (the documented sample). Either becomes a map by type.
 */
function byType(streams: unknown): Record<string, RawStream> {
  const out: Record<string, RawStream> = {};
  if (Array.isArray(streams)) {
    for (const s of streams) {
      if (s && typeof s === "object" && typeof (s as Record<string, unknown>).type === "string") {
        out[(s as Record<string, unknown>).type as string] = s as RawStream;
      }
    }
  } else if (streams && typeof streams === "object") {
    for (const [k, v] of Object.entries(streams as Record<string, unknown>)) {
      if (v && typeof v === "object") out[k] = v as RawStream;
    }
  }
  return out;
}

function laps(detail: Record<string, unknown>): Lap[] {
  const raw = detail.laps;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && typeof l === "object")
    .map((l) => {
      const o = l as Record<string, unknown>;
      return {
        start_index: int(o.start_index),
        end_index: int(o.end_index),
        elapsed_time_s: int(o.elapsed_time),
        moving_time_s: int(o.moving_time),
        distance_m: oneDp(o.distance),
      };
    });
}

export function normaliseActivity(detail: Record<string, unknown>, streams: unknown): CachedPayload {
  const s = byType(streams);
  const deviceWatts = hasDeviceWatts(detail as unknown as StravaActivity);

  const timeData = Array.isArray(s.time?.data) ? (s.time!.data as unknown[]) : null;
  const n = timeData?.length ?? 0;

  // A series is kept only when it lines up sample for sample with time; with
  // no time stream nothing can be placed, so every series is null.
  const series = (key: string, round: (v: unknown) => number | null): Series => {
    if (!timeData) return null;
    const d = s[key]?.data;
    if (!Array.isArray(d) || d.length !== n) return null;
    return d.map(round);
  };

  const time = timeData ? timeData.map(int) : null;
  // Strava estimates watts for a ride with no meter. The app never stores or
  // shows an estimate (mapper.ts hasDeviceWatts).
  const watts = deviceWatts ? series("watts", int) : null;

  // Lap indexes point into the full-resolution stream; once Strava has
  // downsampled, they point at the wrong samples, so the laps are dropped.
  const originalSize = num(s.time?.original_size);
  const downsampled = originalSize != null && originalSize !== n;
  const keepLaps = timeData != null && !downsampled;

  return {
    activity: {
      sport_type: str(detail.sport_type),
      device_name: str(detail.device_name),
      elapsed_time_s: int(detail.elapsed_time),
      moving_time_s: int(detail.moving_time),
      distance_m: oneDp(detail.distance),
      total_elevation_gain_m: oneDp(detail.total_elevation_gain),
      calories: int(detail.calories),
      device_watts: deviceWatts,
      laps: keepLaps ? laps(detail) : [],
    },
    streams: {
      time,
      distance: series("distance", oneDp),
      watts,
      heartrate: series("heartrate", int),
      cadence: series("cadence", int),
      velocity_smooth: series("velocity_smooth", oneDp),
      moving: series("moving", bit),
    },
  };
}
