import { wattsToPace500 } from './pace.js';

// The source-neutral series model for one session, and every calculation the
// session page makes on it. Nothing here knows where a series came from: an
// adapter per source builds one with createSeries, and the page reads only
// this shape.
//
// The model is INTERVALS, not samples: interval i runs from t[i] to t[i+1]
// and carries the values of sample i, its start. The last sample opens no
// interval. So over samples a..b every quantity covers the same b - a
// intervals: elapsed t[b] - t[a], distance dist[b] - dist[a], and every
// time-weighted average sums intervals a..b-1. Sampling once a second, once a
// stroke or irregularly needs no special case.

// An interval is a pause (excluded from moving time and from every average)
// when it is longer than both PAUSE_MIN_S and PAUSE_MEDIAN_FACTOR times the
// series' median interval. The floor keeps a one-second trace from calling a
// 3 s hiccup a pause; the factor keeps a trace sampled every 6 s (or once a
// stroke) from calling every interval one. A `moving` channel can only take
// time away: an interval is live when the channel says moving AND it passes
// the pause rule, because a recorder that drops samples during a stop can
// still flag the long interval that spans it as moving.
export const PAUSE_MIN_S = 5;
export const PAUSE_MEDIAN_FACTOR = 3;

const KNOWN_CHANNELS = ['watts', 'hr', 'rate', 'dist', 'speed'];
const INFO_KEYS = [
  'elapsedS',
  'movingS',
  'distanceM',
  'elevationGainM',
  'calories',
  'device',
  // True when the summary on the page is the athlete's own logged row and the
  // trace was attached to it afterwards.
  'ownSummary',
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

function intervals(t) {
  const n = t.length;
  const dt = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i += 1) dt[i] = Math.max(t[i + 1] - t[i], 0);
  return dt;
}

// live[i]: interval i counts as moving. The last sample opens no interval.
function liveIntervals(dt, moving) {
  const n = dt.length;
  const live = new Array(n).fill(false);
  const typical = median(dt.slice(0, n - 1)) ?? 0;
  const pauseThresholdS = Math.max(PAUSE_MIN_S, PAUSE_MEDIAN_FACTOR * typical);
  for (let i = 0; i < n - 1; i += 1) {
    live[i] = (!moving || !!moving[i]) && dt[i] <= pauseThresholdS;
  }
  return { live, pauseThresholdS };
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
  const dt = intervals(t);
  const { live, pauseThresholdS } = liveIntervals(dt, out.moving);
  return {
    source,
    sampling,
    n,
    t: [...t],
    dt,
    live,
    pauseThresholdS,
    channels: out,
    has,
    laps: cleanLaps,
    info: cleanInfo,
  };
}

function clampRange(series, i0, i1) {
  const last = series.n - 1;
  const a = Math.min(Math.max(Math.trunc(i0 ?? 0), 0), last);
  const b = Math.min(Math.max(Math.trunc(i1 ?? last), 0), last);
  return a <= b ? [a, b] : [b, a];
}

// A sample's value for averaging: power keeps zeros (coasting is real); heart
// rate and rate drop them (a zero there is a dropped sensor).
const KEEPS_ZEROS = { watts: true, speed: true };
function usable(key, v) {
  if (v == null) return false;
  return KEEPS_ZEROS[key] ? true : v > 0;
}

// Time-weighted mean of one channel over the moving intervals a..b-1, each
// carrying the value at its start sample. Null when no time qualifies.
function weightedMean(series, key, a, b) {
  const values = series.channels[key];
  if (!values) return null;
  let sum = 0;
  let weight = 0;
  for (let i = a; i < b; i += 1) {
    if (!series.live[i] || !usable(key, values[i])) continue;
    sum += values[i] * series.dt[i];
    weight += series.dt[i];
  }
  return weight > 0 ? sum / weight : null;
}

function movingSeconds(series, a, b) {
  let s = 0;
  for (let i = a; i < b; i += 1) if (series.live[i]) s += series.dt[i];
  return s;
}

// What happened over samples i0..i1 inclusive, i.e. intervals i0..i1-1.
// `sport` is 'erg' or 'cycling'. A range with no duration gives nulls.
export function rangeStats(series, sport, i0 = 0, i1 = series.n - 1) {
  const [a, b] = clampRange(series, i0, i1);
  const elapsed = series.t[b] - series.t[a];
  const moving = movingSeconds(series, a, b);
  const movingS = moving > 0 ? moving : null;
  const dist = series.channels.dist;
  const distanceM =
    b > a && dist && dist[a] != null && dist[b] != null
      ? dist[b] - dist[a]
      : null;
  const avgWatts = weightedMean(series, 'watts', a, b);
  const avgHr = weightedMean(series, 'hr', a, b);
  const avgRate = weightedMean(series, 'rate', a, b);
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
    elapsedS: elapsed > 0 ? elapsed : null,
    movingS,
    distanceM,
    avgWatts,
    avgHr,
    avgRate,
    pace500,
    speedKmh,
  };
}

// Default split distances: 500 m is the erg's own split; 5 km gives a ride
// of an hour or two a table of a dozen rows. Rowing can also split by 1 km or
// 2 km, the race distance.
export const ROWING_SPLIT_M = 500;
export const CYCLING_SPLIT_M = 5000;
export const ROWING_SPLIT_OPTIONS = [500, 1000, 2000];

// The samples covering times t0..t1 (absolute, on the series' own clock): i0
// is the last sample at or before the earlier time and i1 the first at or
// after the later one, so the range never falls short of what was asked.
// Clamped to the series and ordered.
export function indexRangeForTimes(series, t0, t1) {
  const { t, n } = series;
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  // Last index with t[i] <= x (0 when x is before the first sample).
  const atOrBefore = (x) => {
    let a = 0;
    let b = n - 1;
    if (!(x >= t[0])) return 0;
    while (a < b) {
      const mid = Math.ceil((a + b) / 2);
      if (t[mid] <= x) a = mid;
      else b = mid - 1;
    }
    return a;
  };
  const i0 = atOrBefore(lo);
  let i1 = atOrBefore(hi);
  if (i1 < n - 1 && t[i1] < hi) i1 += 1;
  return { i0, i1: Math.max(i0, i1) };
}

// A point inside the series: interval k (k = n - 1 means the last sample),
// a fraction f of the way through it.
function positionAt(series, time) {
  const { t, dt, n } = series;
  const { i0: k } = indexRangeForTimes(series, time, time);
  if (k >= n - 1 || !(dt[k] > 0)) return { k, f: 0 };
  return { k, f: Math.min(Math.max((time - t[k]) / dt[k], 0), 1) };
}

// Moving seconds from the first sample to a position, a boundary inside an
// interval taking its share of it.
function movingTo(series, cum, { k, f }) {
  const part = k < series.n - 1 && series.live[k] ? f * series.dt[k] : 0;
  return cum[k] + part;
}

function cumulativeMoving(series) {
  const cum = new Array(series.n).fill(0);
  for (let i = 1; i < series.n; i += 1) {
    cum[i] = cum[i - 1] + (series.live[i - 1] ? series.dt[i - 1] : 0);
  }
  return cum;
}

// A split's figures, in rangeStats' shape so the page shows a split and a
// selection the same way. Time and distance run between the interpolated
// boundaries (the intervals a boundary cuts are prorated); average power,
// heart rate and rate come from rangeStats over the enclosing samples i0..i1,
// the same samples selecting the split uses, so the row and the selection
// agree on them.
function splitFigures(series, sport, cum, from, to, startT, endT, distanceM) {
  const i0 = from.k;
  const i1 = to.f > 0 ? to.k + 1 : to.k;
  const inner = rangeStats(series, sport, i0, i1);
  const moving = movingTo(series, cum, to) - movingTo(series, cum, from);
  const movingS = moving > 0 ? moving : null;
  let pace500 = null;
  let speedKmh = null;
  if (sport === 'erg' && distanceM > 0 && movingS) {
    pace500 = (500 * movingS) / distanceM;
  } else if (sport === 'cycling' && distanceM > 0 && movingS) {
    speedKmh = (distanceM / movingS) * 3.6;
  }
  const t0 = series.t[0];
  return {
    i0,
    i1,
    startS: startT - t0,
    endS: endT - t0,
    elapsedS: endT - startT > 0 ? endT - startT : null,
    movingS,
    distanceM,
    avgWatts: inner.avgWatts,
    avgHr: inner.avgHr,
    avgRate: inner.avgRate,
    pace500,
    speedKmh,
  };
}

// Splits every `splitM` metres along the distance channel. A boundary's time
// is interpolated linearly between the two samples either side of it. The
// last split is whatever distance is left, marked partial and always shown.
// [] without a distance channel.
export function distanceSplits(series, sport, splitM) {
  const dist = series.channels.dist;
  if (!dist || !(splitM > 0)) return [];
  const known = [];
  for (let i = 0; i < series.n; i += 1) if (dist[i] != null) known.push(i);
  if (known.length < 2) return [];
  const first = known[0];
  const last = known.at(-1);
  const total = dist[last] - dist[first];
  if (!(total > 0)) return [];
  const { t } = series;
  const cum = cumulativeMoving(series);
  // Boundary times, from the first known distance to the last.
  const times = [t[first]];
  let j = 0;
  for (let d = dist[first] + splitM; d < dist[last] - 1e-6; d += splitM) {
    while (j < known.length - 1 && dist[known[j + 1]] < d) j += 1;
    const a = known[j];
    const b = known[j + 1];
    const span = dist[b] - dist[a];
    const frac = span > 0 ? (d - dist[a]) / span : 0;
    times.push(t[a] + frac * (t[b] - t[a]));
  }
  times.push(t[last]);
  const splits = [];
  for (let s = 0; s < times.length - 1; s += 1) {
    const lastSplit = s === times.length - 2;
    const distanceM = lastSplit ? total - s * splitM : splitM;
    splits.push({
      index: s,
      partial: lastSplit && distanceM < splitM - 1e-6,
      ...splitFigures(
        series,
        sport,
        cum,
        positionAt(series, times[s]),
        positionAt(series, times[s + 1]),
        times[s],
        times[s + 1],
        distanceM
      ),
    });
  }
  return splits;
}

// One split per recorded lap, only when there is more than one: a single
// lap is the whole session again.
export function lapSplits(series, sport) {
  if (series.laps.length < 2) return [];
  const t0 = series.t[0];
  return series.laps.map((lap, index) => {
    const stats = rangeStats(series, sport, lap.i0, lap.i1);
    return {
      ...stats,
      index,
      partial: false,
      startS: series.t[stats.i0] - t0,
      endS: series.t[stats.i1] - t0,
    };
  });
}

// Pace for one sample, for drawing only.
function samplePace(watts, speed) {
  if (watts > 0) return wattsToPace500(watts);
  if (speed > 0) return 500 / speed;
  return null;
}

const ROW_KEYS = ['watts', 'hr', 'rate', 'speed', 'pace'];

// One sample's drawable values; a value that would not count in an average
// (a heart-rate zero, say) draws as nothing.
function sampleRow(series, sport, i) {
  const { channels } = series;
  const row = { x: series.t[i] - series.t[0] };
  for (const key of ['watts', 'hr', 'rate', 'speed']) {
    const v = channels[key]?.[i] ?? null;
    row[key] = usable(key, v) ? v : null;
  }
  row.pace =
    sport === 'erg'
      ? samplePace(channels.watts?.[i], channels.speed?.[i])
      : null;
  return row;
}

const gapRow = (x) => {
  const row = { x };
  for (const key of ROW_KEYS) row[key] = null;
  return row;
};

// Rows for the trace. Drawing only: every number on the page is computed on
// the full series. A null row marks a real gap (a pause, or `moving` off) so
// the line breaks there and nowhere else.
//   n <= maxPoints: one row per sample, x = t[i] - t[0].
//   above that: consecutive moving intervals grouped by index, each value the
//   group's time-weighted mean, plus one row per run at its closing sample
//   carrying that sample's own values (as the per-sample path draws it), so
//   the line reaches the run's end. The group size leaves room for those rows
//   and the gaps, so the total stays within maxPoints. Grouping by index, not
//   by clock, means irregular spacing can never leave an empty group.
export function downsample(series, sport, maxPoints = 600) {
  const { n, t, live } = series;
  const t0 = t[0];
  const rows = [];
  const pushGap = (x) => {
    const last = rows.at(-1);
    if (last && ROW_KEYS.every((k) => last[k] == null)) return;
    if (rows.length) rows.push(gapRow(x));
  };

  if (n <= maxPoints) {
    for (let i = 0; i < n; i += 1) {
      // A sample is drawn when it starts or ends a moving interval; samples
      // wholly inside a stop are the gap itself.
      const drawn = n === 1 || live[i] || (i > 0 && live[i - 1]);
      if (drawn) rows.push(sampleRow(series, sport, i));
      if (i < n - 1 && !live[i]) pushGap((t[i] + t[i + 1]) / 2 - t0);
    }
    return rows;
  }

  // Runs of consecutive moving intervals, split at every gap.
  const runs = [];
  let start = null;
  for (let i = 0; i < n - 1; i += 1) {
    if (live[i] && start == null) start = i;
    if (!live[i] && start != null) {
      runs.push([start, i]);
      start = null;
    }
  }
  if (start != null) runs.push([start, n - 1]);
  const liveCount = runs.reduce((s, [a, b]) => s + (b - a), 0);
  // Groups per run round up (at most one extra each), each run adds a closing
  // row, and each run after the first a gap row.
  const budget = Math.max(1, maxPoints - 3 * runs.length + 1);
  const size = Math.max(1, Math.ceil(liveCount / budget));

  runs.forEach(([a, b], r) => {
    if (r > 0) pushGap((t[runs[r - 1][1]] + t[a]) / 2 - t0);
    for (let g = a; g < b; g += size) {
      const end = Math.min(g + size, b);
      const row = { x: t[g] - t0 };
      for (const key of ROW_KEYS) {
        let sum = 0;
        let weight = 0;
        let plain = 0;
        let count = 0;
        for (let i = g; i < end; i += 1) {
          const v =
            key === 'pace'
              ? sport === 'erg'
                ? samplePace(
                    series.channels.watts?.[i],
                    series.channels.speed?.[i]
                  )
                : null
              : (series.channels[key]?.[i] ?? null);
          if (key === 'pace' ? v == null : !usable(key, v)) continue;
          sum += v * series.dt[i];
          weight += series.dt[i];
          plain += v;
          count += 1;
        }
        // Zero-duration intervals carry no weight; fall back to a plain mean.
        row[key] = weight > 0 ? sum / weight : count ? plain / count : null;
      }
      rows.push(row);
    }
    rows.push(sampleRow(series, sport, b));
  });
  return rows;
}

// Numbers the stored row does not carry, computed from the series over the
// same moving intervals as every average, so they work for any source. Each
// is null when the series cannot support it.
export function seriesExtras(series) {
  const { watts, hr } = series.channels;
  let maxWatts = null;
  let maxHr = null;
  let joules = 0;
  for (let i = 0; i < series.n - 1; i += 1) {
    if (!series.live[i]) continue;
    const w = watts?.[i];
    if (w != null) {
      if (maxWatts == null || w > maxWatts) maxWatts = w;
      joules += w * series.dt[i];
    }
    const h = hr?.[i];
    if (h > 0 && (maxHr == null || h > maxHr)) maxHr = h;
  }
  return {
    maxWatts,
    maxHr,
    avgRate: weightedMean(series, 'rate', 0, series.n - 1),
    workKj: maxWatts == null ? null : joules / 1000,
  };
}
