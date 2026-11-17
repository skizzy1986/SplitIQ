import { wattsToPace500 } from './pace.js';

// The source-neutral series model for one session, and every calculation the
// session page makes on it. Nothing here knows where a series came from: an
// adapter per source builds one with createSeries, and the page reads only
// this shape. Every statistic is weighted by each sample's own duration, so a
// series sampled once a second, once a stroke or irregularly needs no special
// case.

// A gap longer than this is a pause, not a sample: it counts this long at most,
// so a stop never inflates a time-weighted average or the moving time.
export const MAX_SAMPLE_S = 5;

const KNOWN_CHANNELS = ['watts', 'hr', 'rate', 'dist', 'speed'];
const INFO_KEYS = [
  'elapsedS',
  'movingS',
  'distanceM',
  'elevationGainM',
  'calories',
  'device',
  'origin',
  'ref',
  'href',
  'fetchedAt',
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sampleDurations(t) {
  const n = t.length;
  const dt = new Array(n);
  for (let i = 0; i < n - 1; i += 1) {
    dt[i] = Math.min(Math.max(t[i + 1] - t[i], 0), MAX_SAMPLE_S);
  }
  dt[n - 1] = n > 1 ? median(dt.slice(0, n - 1)) : 1;
  return dt;
}

// Throws on a malformed series: an adapter that hands over mismatched arrays
// has a bug, and drawing a trace from it would misplace every sample.
export function createSeries({
  source,
  sampling = 'time',
  t,
  channels = {},
  laps = [],
  info = {},
} = {}) {
  if (typeof source !== 'string' || !source) {
    throw new Error('series: source is required');
  }
  if (sampling !== 'time' && sampling !== 'stroke') {
    throw new Error(`series: unknown sampling ${sampling}`);
  }
  if (!Array.isArray(t) || t.length === 0) {
    throw new Error('series: t must be a non-empty array');
  }
  for (let i = 0; i < t.length; i += 1) {
    if (num(t[i]) == null || (i > 0 && t[i] < t[i - 1])) {
      throw new Error('series: t must be finite and non-decreasing');
    }
  }
  const n = t.length;
  const out = {};
  for (const [key, values] of Object.entries(channels ?? {})) {
    if (values == null) {
      out[key] = null;
      continue;
    }
    if (!Array.isArray(values) || values.length !== n) {
      throw new Error(`series: channel ${key} must have ${n} samples`);
    }
    // Known numeric channels are cleaned to number-or-null; `moving` and any
    // extra channel pass through untouched.
    out[key] = KNOWN_CHANNELS.includes(key) ? values.map(num) : values;
  }
  for (const key of [...KNOWN_CHANNELS, 'moving']) {
    if (!(key in out)) out[key] = null;
  }
  const any = (key, test) => !!out[key] && out[key].some(test);
  const has = {
    power: any('watts', (v) => v != null),
    hr: any('hr', (v) => v > 0),
    rate: any('rate', (v) => v > 0),
    distance: any('dist', (v) => v != null),
  };
  const cleanLaps = (laps ?? [])
    .filter(
      (l) =>
        Number.isInteger(l?.i0) &&
        Number.isInteger(l?.i1) &&
        l.i0 >= 0 &&
        l.i0 <= l.i1 &&
        l.i1 < n
    )
    .map((l) => ({
      i0: l.i0,
      i1: l.i1,
      elapsedS: num(l.elapsedS),
      movingS: num(l.movingS),
      distanceM: num(l.distanceM),
    }));
  const cleanInfo = {};
  for (const key of INFO_KEYS) cleanInfo[key] = info?.[key] ?? null;
  return {
    source,
    sampling,
    n,
    t: [...t],
    dt: sampleDurations(t),
    channels: out,
    has,
    laps: cleanLaps,
    info: cleanInfo,
  };
}

const isMoving = (series, i) => {
  const moving = series.channels.moving;
  return moving ? !!moving[i] : true;
};

function clampRange(series, i0, i1) {
  const last = series.n - 1;
  const a = Math.min(Math.max(Math.trunc(i0 ?? 0), 0), last);
  const b = Math.min(Math.max(Math.trunc(i1 ?? last), 0), last);
  return a <= b ? [a, b] : [b, a];
}

// Time-weighted mean of one channel over the moving samples of [i0, i1].
function weightedMean(series, key, i0, i1, keepZeros) {
  const values = series.channels[key];
  if (!values) return null;
  let sum = 0;
  let weight = 0;
  for (let i = i0; i <= i1; i += 1) {
    const v = values[i];
    if (v == null || !isMoving(series, i)) continue;
    if (!keepZeros && !(v > 0)) continue;
    sum += v * series.dt[i];
    weight += series.dt[i];
  }
  return weight > 0 ? sum / weight : null;
}

// What happened over samples i0..i1 inclusive. `sport` is 'erg' or 'cycling'.
export function rangeStats(series, sport, i0 = 0, i1 = series.n - 1) {
  const [a, b] = clampRange(series, i0, i1);
  let movingS = 0;
  for (let i = a; i <= b; i += 1) {
    if (isMoving(series, i)) movingS += series.dt[i];
  }
  const dist = series.channels.dist;
  const distanceM =
    dist && dist[a] != null && dist[b] != null ? dist[b] - dist[a] : null;
  // Power counts zeros (coasting is real); heart rate and rate do not (a zero
  // there is a dropped sensor).
  const avgWatts = weightedMean(series, 'watts', a, b, true);
  const avgHr = weightedMean(series, 'hr', a, b, false);
  const avgRate = weightedMean(series, 'rate', a, b, false);
  let pace500 = null;
  let speedKmh = null;
  if (sport === 'erg') {
    if (distanceM > 0 && movingS > 0) pace500 = (500 * movingS) / distanceM;
    else if (avgWatts > 0) pace500 = wattsToPace500(avgWatts);
  } else if (sport === 'cycling' && distanceM > 0 && movingS > 0) {
    speedKmh = (distanceM / movingS) * 3.6;
  }
  return {
    i0: a,
    i1: b,
    elapsedS: series.t[b] - series.t[a],
    movingS,
    distanceM,
    avgWatts,
    avgHr,
    avgRate,
    pace500,
    speedKmh,
  };
}

// Pace for one sample, for drawing only.
function samplePace(watts, speed) {
  if (watts > 0) return wattsToPace500(watts);
  if (speed > 0) return 500 / speed;
  return null;
}

// Rows for the trace: fixed time buckets, x the bucket start in seconds from
// the first sample, each value the bucket's mean. A bucket with no data is
// null so a gap draws as a gap. Drawing only: every number on the page is
// computed on the full series.
export function downsample(series, sport, maxPoints = 600) {
  const { t, n, channels } = series;
  const t0 = t[0];
  const span = t[n - 1] - t0;
  const buckets = Math.max(1, Math.min(maxPoints, n));
  const width = span > 0 ? span / buckets : 1;
  const keys = ['watts', 'hr', 'rate', 'speed', 'pace'];
  const sums = keys.map(() => new Array(buckets).fill(0));
  const counts = keys.map(() => new Array(buckets).fill(0));
  const value = (key, i) => {
    if (key === 'pace') {
      return sport === 'erg'
        ? samplePace(channels.watts?.[i], channels.speed?.[i])
        : null;
    }
    const v = channels[key]?.[i] ?? null;
    if (v == null) return null;
    if ((key === 'hr' || key === 'rate') && !(v > 0)) return null;
    return v;
  };
  for (let i = 0; i < n; i += 1) {
    const b = Math.min(Math.floor((t[i] - t0) / width), buckets - 1);
    keys.forEach((key, k) => {
      const v = value(key, i);
      if (v == null) return;
      sums[k][b] += v;
      counts[k][b] += 1;
    });
  }
  const rows = [];
  for (let b = 0; b < buckets; b += 1) {
    const row = { x: b * width };
    keys.forEach((key, k) => {
      row[key] = counts[k][b] ? sums[k][b] / counts[k][b] : null;
    });
    rows.push(row);
  }
  return rows;
}

// Numbers the stored row does not carry, computed from the series so they
// work for any source. Each is null when the series cannot support it.
export function seriesExtras(series) {
  const { watts, hr } = series.channels;
  let maxWatts = null;
  let maxHr = null;
  let joules = 0;
  if (watts) {
    for (let i = 0; i < series.n; i += 1) {
      const w = watts[i];
      if (w == null) continue;
      if (maxWatts == null || w > maxWatts) maxWatts = w;
      joules += w * series.dt[i];
    }
  }
  if (hr) {
    for (const v of hr) if (v > 0 && (maxHr == null || v > maxHr)) maxHr = v;
  }
  return {
    maxWatts,
    maxHr,
    avgRate: weightedMean(series, 'rate', 0, series.n - 1, false),
    workKj: maxWatts == null ? null : joules / 1000,
  };
}
