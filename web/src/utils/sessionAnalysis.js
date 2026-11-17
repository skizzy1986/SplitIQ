// Analysis on the source-neutral series (utils/sessionSeries.js).

// Time in each zone. `zones` is derivePaceZones(cp) or deriveCyclingZones(ftp):
// bands are [wattsLow, wattsHigh) and the top band is open-ended, so rowing
// power above the AN ceiling still counts as AN. Only moving intervals (the
// same ones every average uses) with a power reading at their start count;
// moving time without one is reported as unpoweredS.
export function timeInZones(series, zones) {
  if (!series || !Array.isArray(zones) || !zones.length) return null;
  const watts = series.channels.watts;
  const seconds = zones.map(() => 0);
  let zonedS = 0;
  let unpoweredS = 0;
  const last = zones.length - 1;
  for (let i = 0; i < series.n - 1; i += 1) {
    if (!series.live[i]) continue;
    const dt = series.dt[i];
    const w = watts ? watts[i] : null;
    if (w == null || w < 0) {
      unpoweredS += dt;
      continue;
    }
    let z = zones.findIndex(
      (band, k) => k < last && w >= band.wattsLow && w < band.wattsHigh
    );
    if (z === -1) z = w >= zones[last].wattsLow ? last : 0;
    seconds[z] += dt;
    zonedS += dt;
  }
  return {
    bands: zones.map((band, k) => ({
      zone: band.zone,
      key: band.key ?? band.zone,
      color: band.color,
      seconds: seconds[k],
      fraction: zonedS > 0 ? seconds[k] / zonedS : 0,
    })),
    zonedS,
    unpoweredS,
  };
}

// The zone holding more than half the zoned time, or null.
export function dominantZone(result) {
  if (!result || !(result.zonedS > 0)) return null;
  return result.bands.find((b) => b.fraction > 0.5) ?? null;
}

// The figures behind "More detail". Each describes the session, so each
// refuses to exist on too little data rather than show a number that means
// nothing.

// Weighted power, variability and drift need this much moving time: a 30 s
// smoothing and two halves say little about a shorter session.
export const MIN_ANALYSIS_S = 1200;
// ...and a reading for this share of it: below that, the gaps decide the
// figure more than the effort does.
export const MIN_COVERAGE = 0.8;
// Peak powers over 1, 5 and 20 minutes: a sprint, a hard interval and a
// sustained effort.
export const PEAK_WINDOWS = [60, 300, 1200];
// Weighted power's rolling window, in seconds.
const SMOOTHING_S = 30;

const reading = (key, v) => v != null && (key === 'watts' ? v >= 0 : v > 0);

// Moving seconds in the whole series, those with a reading of `key`, and
// the time-weighted mean of those readings.
function coverage(series, key) {
  const values = series.channels[key];
  let moving = 0;
  let covered = 0;
  let sum = 0;
  for (let i = 0; i < series.n - 1; i += 1) {
    if (!series.live[i]) continue;
    moving += series.dt[i];
    if (!reading(key, values?.[i])) continue;
    covered += series.dt[i];
    sum += values[i] * series.dt[i];
  }
  return {
    moving,
    covered,
    share: moving > 0 ? covered / moving : 0,
    mean: covered > 0 ? sum / covered : null,
  };
}

// Moving time cut in two halves by cumulative moving seconds; the interval
// the cut falls in is shared between them. Per half: the time-weighted
// average power (zeros kept) and heart rate (zeros dropped), and the share of
// the half with a heart-rate reading.
function driftHalves(series) {
  const { watts, hr } = series.channels;
  const half = coverage(series, 'watts').moving / 2;
  const acc = [0, 1].map(() => ({ w: 0, wt: 0, h: 0, ht: 0, time: 0 }));
  let clock = 0;
  for (let i = 0; i < series.n - 1; i += 1) {
    if (!series.live[i]) continue;
    const d = series.dt[i];
    const before = Math.min(Math.max(half - clock, 0), d);
    [before, d - before].forEach((p, k) => {
      if (!(p > 0)) return;
      const a = acc[k];
      a.time += p;
      if (reading('watts', watts?.[i])) {
        a.w += watts[i] * p;
        a.wt += p;
      }
      if (reading('hr', hr?.[i])) {
        a.h += hr[i] * p;
        a.ht += p;
      }
    });
    clock += d;
  }
  return acc.map((a) => ({
    watts: a.wt > 0 ? a.w / a.wt : null,
    hr: a.ht > 0 ? a.h / a.ht : null,
    hrShare: a.time > 0 ? a.ht / a.time : 0,
  }));
}

// What the series lacks for weighted power and variability, and for drift:
// null when it has enough, else 'duration' (under MIN_ANALYSIS_S of moving
// time), 'power' (a reading for under MIN_COVERAGE of it, or an average of
// 0 W, which leaves nothing to divide by) or 'hr' (for drift, a heart-rate
// reading for under MIN_COVERAGE of either half).
export function analysisNeeds(series) {
  const power = coverage(series, 'watts');
  let variability = null;
  if (power.moving < MIN_ANALYSIS_S) variability = 'duration';
  else if (power.share < MIN_COVERAGE || !(power.mean > 0)) {
    variability = 'power';
  }
  let drift = variability;
  if (!drift) {
    const halves = driftHalves(series);
    if (halves.some((h) => h.hrShare < MIN_COVERAGE)) drift = 'hr';
    else if (halves.some((h) => !(h.watts > 0))) drift = 'power';
  }
  return { variability, drift };
}

// Power as a step function of elapsed time: a pause, or a moving interval
// with no reading, counts as 0 W.
function stepWatts(series, i) {
  const w = series.channels.watts?.[i];
  return series.live[i] && w > 0 ? w : 0;
}

// The best average power over each window across elapsed time, a pause
// counting as 0 W: [{ windowS, watts, needs }], watts null when the session
// is shorter than the window (needs 'duration') or has no power (needs
// 'power'). Power is piecewise constant, so the energy in a sliding window
// is piecewise linear in where the window starts, and its maximum has the
// window's start or its end on a sample time: testing exactly those windows
// is exact. Each pass moves its pointer forward only, so O(n) per window.
export function peakPowers(series) {
  const { t, n, dt } = series;
  const elapsed = t[n - 1] - t[0];
  // energy[i]: joules from t[0] to t[i].
  const energy = new Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    energy[i] = energy[i - 1] + stepWatts(series, i - 1) * dt[i - 1];
  }
  // Joules from t[0] to time x. `at.k` is the interval x was last found in;
  // the queried times only increase, so it only moves forward.
  const energyAt = (x, at) => {
    while (at.k < n - 1 && t[at.k + 1] <= x) at.k += 1;
    if (at.k >= n - 1) return energy[n - 1];
    return energy[at.k] + stepWatts(series, at.k) * (x - t[at.k]);
  };
  return PEAK_WINDOWS.map((windowS) => {
    if (!series.has.power) return { windowS, watts: null, needs: 'power' };
    if (!(elapsed >= windowS)) {
      return { windowS, watts: null, needs: 'duration' };
    }
    let best = 0;
    const ahead = { k: 0 };
    for (let i = 0; i < n && t[i] + windowS <= t[n - 1]; i += 1) {
      best = Math.max(best, energyAt(t[i] + windowS, ahead) - energy[i]);
    }
    const behind = { k: 0 };
    for (let j = 0; j < n; j += 1) {
      if (t[j] - windowS < t[0]) continue;
      best = Math.max(best, energy[j] - energyAt(t[j] - windowS, behind));
    }
    // A session of zeros has no peak to show, only a missing reading.
    if (!(best > 0)) return { windowS, watts: null, needs: 'power' };
    return { windowS, watts: best / windowS, needs: null };
  });
}

// Moving time with a power reading, joined end to end and resampled to one
// value a second, each the exact mean of the step function over that second.
// Intervals with no reading are left out; analysisNeeds has already required
// them to be under a fifth of the moving time.
function secondsOfPower(series) {
  const watts = series.channels.watts;
  const count = Math.floor(coverage(series, 'watts').covered);
  const out = new Array(count).fill(0);
  let clock = 0;
  for (let i = 0; i < series.n - 1; i += 1) {
    const d = series.dt[i];
    if (!series.live[i] || !reading('watts', watts?.[i]) || !(d > 0)) continue;
    const end = clock + d;
    for (let s = Math.floor(clock); s < end && s < count; s += 1) {
      out[s] += watts[i] * (Math.min(end, s + 1) - Math.max(clock, s));
    }
    clock = end;
  }
  return out;
}

// Weighted power: over moving time, a 30 s rolling mean of power, each value
// raised to the fourth power, their mean, and its fourth root. Null when
// analysisNeeds finds too little.
export function normalizedPower(series) {
  if (analysisNeeds(series).variability) return null;
  const secs = secondsOfPower(series);
  let rolling = 0;
  let sum4 = 0;
  let count = 0;
  for (let s = 0; s < secs.length; s += 1) {
    rolling += secs[s];
    if (s >= SMOOTHING_S) rolling -= secs[s - SMOOTHING_S];
    if (s < SMOOTHING_S - 1) continue;
    sum4 += (rolling / SMOOTHING_S) ** 4;
    count += 1;
  }
  return count ? (sum4 / count) ** 0.25 : null;
}

// Weighted power against the average: { np, avg, vi }, avg being the
// moving-time average power, the same basis as rangeStats' avgWatts. Null on
// too little data.
export function variabilityIndex(series) {
  const np = normalizedPower(series);
  if (np == null) return null;
  const watts = series.channels.watts;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < series.n - 1; i += 1) {
    if (!series.live[i] || !reading('watts', watts[i])) continue;
    sum += watts[i] * series.dt[i];
    weight += series.dt[i];
  }
  const avg = weight > 0 ? sum / weight : null;
  if (!(avg > 0)) return null;
  return { np, avg, vi: np / avg };
}

// Power per heartbeat in the first half of moving time against the second:
// { firstRatio, secondRatio, driftPct }, each ratio average watts over
// average heart rate and driftPct = (first - second) / first x 100. Null on
// too little data.
export function aerobicDrift(series) {
  if (analysisNeeds(series).drift) return null;
  const [one, two] = driftHalves(series);
  const firstRatio = one.watts / one.hr;
  const secondRatio = two.watts / two.hr;
  return {
    firstRatio,
    secondRatio,
    driftPct: ((firstRatio - secondRatio) / firstRatio) * 100,
  };
}
