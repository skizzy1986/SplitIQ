import {
  CYCLING_SPLIT_M,
  PAUSE_MEDIAN_FACTOR,
  PAUSE_MIN_S,
  ROWING_SPLIT_M,
  ROWING_SPLIT_OPTIONS,
  createSeries,
  distanceSplits,
  downsample,
  indexRangeForTimes,
  lapSplits,
  rangeStats,
  seriesExtras,
} from '../sessionSeries.js';
import { wattsToPace500 } from '../pace.js';
import { captureSeries } from '../../test/sessionFixtures.js';

// Every series here is synthetic: invented numbers, no real session.
// `steady(n, step)`: n samples every `step` s, 4 m/s, 200 W, 140 bpm, 24 spm.
const steady = (n, step = 1, watts = 200) =>
  createSeries({
    source: 'test',
    t: Array.from({ length: n }, (_, i) => i * step),
    channels: {
      watts: Array(n).fill(watts),
      hr: Array(n).fill(140),
      rate: Array(n).fill(24),
      dist: Array.from({ length: n }, (_, i) => i * 4 * step),
    },
  });

const isGap = (row) =>
  ['watts', 'hr', 'rate', 'speed', 'pace'].every((k) => row[k] == null);

describe('createSeries', () => {
  it('builds intervals: dt[i] = t[i+1] - t[i], and the last sample opens none', () => {
    const s = createSeries({
      source: 'test',
      t: [0, 1, 3, 20, 21],
      channels: { watts: [100, null, 120, 130, 140], hr: [0, 0, 0, 0, 0] },
    });
    expect(s.n).toBe(5);
    expect(s.dt).toEqual([1, 2, 17, 1, 0]);
    // Median interval 1.5 s, so the pause threshold is the 5 s floor.
    expect(s.pauseThresholdS).toBe(PAUSE_MIN_S);
    expect(s.live).toEqual([true, true, false, true, false]);
    expect(s.has).toEqual({
      power: true,
      hr: false,
      rate: false,
      distance: false,
    });
    expect(s.channels.rate).toBeNull();
    expect(s.info).toMatchObject({
      elapsedS: null,
      ref: null,
      ownSummary: null,
    });
  });

  it('gives a single sample no interval at all', () => {
    const s = createSeries({ source: 'x', t: [5] });
    expect(s.dt).toEqual([0]);
    expect(s.live).toEqual([false]);
  });

  it('rejects a malformed series', () => {
    expect(() => createSeries({ source: 'x', t: [] })).toThrow();
    expect(() => createSeries({ source: 'x', t: [0, 2, 1] })).toThrow();
    expect(() => createSeries({ t: [0, 1] })).toThrow();
    expect(() =>
      createSeries({ source: 'x', t: [0, 1], channels: { watts: [1] } })
    ).toThrow();
    expect(() =>
      createSeries({ source: 'x', sampling: 'lap', t: [0, 1] })
    ).toThrow();
  });

  it('passes an extra channel through untouched and keeps valid laps', () => {
    const s = captureSeries();
    expect(s.sampling).toBe('stroke');
    expect(s.channels.driveLength).toEqual([
      1.4, 1.42, 1.41, 1.43, 1.4, 1.39, 1.41, 1.42,
    ]);
    const lapped = createSeries({
      source: 'x',
      t: [0, 1, 2],
      laps: [
        { i0: 0, i1: 1, elapsedS: 1 },
        { i0: 2, i1: 9 },
      ],
    });
    expect(lapped.laps).toEqual([
      { i0: 0, i1: 1, elapsedS: 1, movingS: null, distanceM: null },
    ]);
  });

  it('trusts a moving channel given as 0/1 numbers, including a 0', () => {
    const s = createSeries({
      source: 'x',
      t: [0, 1, 2, 3],
      channels: { moving: [1, 0, 1, 1] },
    });
    expect(s.live).toEqual([true, false, true, false]);
    // The pause rule is always worked out, moving channel or not.
    expect(s.pauseThresholdS).toBe(PAUSE_MIN_S);
  });

  it('never counts a long gap as live, even when the moving channel says moving', () => {
    // Sampling stopped for 120 s while the recorder still flagged moving.
    const s = createSeries({
      source: 'x',
      t: [0, 1, 2, 122, 123, 124],
      channels: { watts: Array(6).fill(200), moving: [1, 1, 1, 1, 1, 1] },
    });
    expect(s.live).toEqual([true, true, false, true, true, false]);
    expect(rangeStats(s, 'cycling').movingS).toBe(4);
  });
});

describe('rangeStats', () => {
  it('a steady row: every quantity covers the same intervals', () => {
    // 601 samples, 600 one-second intervals, 2400 m: exactly 125.0 s /500 m.
    const r = rangeStats(steady(601), 'erg');
    expect(r.elapsedS).toBe(600);
    expect(r.movingS).toBe(600);
    expect(r.distanceM).toBe(2400);
    expect(r.avgWatts).toBe(200);
    expect(r.avgHr).toBe(140);
    expect(r.avgRate).toBe(24);
    expect(r.pace500).toBe(125);
    expect(r.speedKmh).toBeNull();
  });

  it('a steady ride: exactly 14.4 km/h', () => {
    expect(rangeStats(steady(11), 'cycling').speedKmh).toBeCloseTo(14.4, 10);
  });

  it('a sub-range of 3 s has 3 s of moving time', () => {
    const part = rangeStats(steady(11), 'erg', 2, 5);
    expect(part).toMatchObject({
      i0: 2,
      i1: 5,
      elapsedS: 3,
      movingS: 3,
      distanceM: 12,
    });
    // Out-of-range and reversed indices are clamped and ordered.
    expect(rangeStats(steady(11), 'erg', 50, -3)).toMatchObject({
      i0: 0,
      i1: 10,
    });
  });

  it('a trace sampled every 6 s counts every interval as moving', () => {
    const r = rangeStats(steady(101, 6), 'erg');
    expect(r.elapsedS).toBe(600);
    expect(r.movingS).toBe(600);
    expect(r.pace500).toBe(125);
  });

  it('a real pause is excluded from moving time and from every average', () => {
    // 1 s samples at 200 W, then 120 s with nothing, then 1 s samples at 100 W.
    const t = [0, 1, 2, 3, 123, 124, 125, 126];
    const s = createSeries({
      source: 'x',
      t,
      channels: {
        watts: [200, 200, 200, 0, 100, 100, 100, 100],
        dist: [0, 4, 8, 12, 12, 16, 20, 24],
      },
    });
    const r = rangeStats(s, 'erg');
    expect(r.elapsedS).toBe(126);
    expect(r.movingS).toBe(6);
    // Intervals 0-2 at 200 W, the pause excluded, 4-6 at 100 W.
    expect(r.avgWatts).toBe(150);
    expect(r.pace500).toBe(125);
  });

  it('a moving channel of 0/1: a 0 interval counts nowhere', () => {
    const s = createSeries({
      source: 'x',
      t: [0, 1, 2, 3, 4],
      channels: {
        watts: [100, 999, 200, 300, 0],
        hr: [120, 200, 0, 160, 0],
        moving: [1, 0, 1, 1, 1],
      },
    });
    const r = rangeStats(s, 'erg');
    expect(r.movingS).toBe(3);
    // Power keeps a zero; heart rate drops one.
    expect(r.avgWatts).toBe(200);
    expect(r.avgHr).toBe(140);
    expect(r.distanceM).toBeNull();
    expect(r.pace500).toBeCloseTo(wattsToPace500(200));
  });

  it('time-weights an irregular, per-stroke series', () => {
    const s = captureSeries();
    // Intervals 2.4, 2.5, 2.2, 2.7, 2.2, 18, 2.5: median 2.5, threshold 7.5,
    // so the 18 s gap is a pause.
    expect(s.pauseThresholdS).toBe(PAUSE_MEDIAN_FACTOR * 2.5);
    const r = rangeStats(s, 'erg');
    expect(r.movingS).toBeCloseTo(14.5);
    const watts = [180, 200, 220, 210, 190, 0, 200];
    const dt = [2.4, 2.5, 2.2, 2.7, 2.2, 0, 2.5];
    const expected =
      watts.reduce((a, w, i) => a + w * dt[i], 0) / dt.reduce((a, b) => a + b);
    expect(r.avgWatts).toBeCloseTo(expected);
    expect(r.distanceM).toBe(65);
    expect(r.elapsedS).toBe(32.5);
  });

  it('a single sample gives null statistics, never a division by zero', () => {
    const s = createSeries({
      source: 'x',
      t: [7],
      channels: { watts: [200], dist: [0], hr: [140] },
    });
    expect(rangeStats(s, 'erg')).toMatchObject({
      elapsedS: null,
      movingS: null,
      distanceM: null,
      avgWatts: null,
      avgHr: null,
      pace500: null,
    });
    // A zero-duration series likewise.
    const flat = createSeries({
      source: 'x',
      t: [3, 3, 3],
      channels: { watts: [1, 2, 3] },
    });
    expect(rangeStats(flat, 'cycling')).toMatchObject({
      elapsedS: null,
      movingS: null,
      avgWatts: null,
      speedKmh: null,
    });
  });
});

describe('downsample', () => {
  it('one row per sample when n <= maxPoints, x from the first sample', () => {
    const rows = downsample(steady(5, 6), 'erg', 600);
    expect(rows.map((r) => r.x)).toEqual([0, 6, 12, 18, 24]);
    expect(rows[0].pace).toBeCloseTo(wattsToPace500(200));
  });

  it('an irregular 1 to 4 s grid below maxPoints has no null rows', () => {
    const t = [0];
    for (let i = 1; i < 200; i += 1) t.push(t[i - 1] + 1 + (i % 4));
    const s = createSeries({
      source: 'x',
      t,
      channels: { watts: t.map(() => 180) },
    });
    const rows = downsample(s, 'erg');
    expect(rows).toHaveLength(200);
    expect(rows.some(isGap)).toBe(false);
  });

  it('groups a long series into at most maxPoints rows, none empty', () => {
    const rows = downsample(steady(3 * 3600), 'erg', 600);
    expect(rows.length).toBeLessThanOrEqual(600);
    expect(rows.some(isGap)).toBe(false);
    expect(rows[0].x).toBe(0);
    expect(rows[0].watts).toBe(200);
  });

  it('an irregular long series never leaves an empty group', () => {
    const t = [0];
    for (let i = 1; i < 5000; i += 1)
      t.push(t[i - 1] + (i % 7 === 0 ? 4 : 0.5));
    const s = createSeries({
      source: 'x',
      t,
      channels: { watts: t.map(() => 150) },
    });
    const rows = downsample(s, 'cycling', 600);
    expect(rows.length).toBeLessThanOrEqual(600);
    expect(rows.some(isGap)).toBe(false);
  });

  it('draws a gap exactly where a pause sits, small series and large', () => {
    const t = [0, 1, 2, 100, 101, 102];
    const s = createSeries({
      source: 'x',
      t,
      channels: { watts: [100, 100, 100, 200, 200, 200] },
    });
    const rows = downsample(s, 'cycling');
    expect(rows.filter(isGap)).toHaveLength(1);
    expect(rows.findIndex(isGap)).toBe(3);

    const long = [];
    for (let i = 0; i < 2000; i += 1) long.push(i < 1000 ? i : i + 300);
    const big = createSeries({
      source: 'x',
      t: long,
      channels: { watts: long.map(() => 150) },
    });
    const bigRows = downsample(big, 'cycling', 100);
    expect(bigRows.filter(isGap)).toHaveLength(1);
  });

  it('draws a gap where moving is 0, and only there', () => {
    const s = createSeries({
      source: 'x',
      t: [0, 1, 2, 3, 4, 5],
      channels: {
        watts: [100, 100, 0, 0, 100, 100],
        moving: [1, 1, 0, 0, 1, 1],
      },
    });
    const rows = downsample(s, 'cycling');
    expect(rows.filter(isGap)).toHaveLength(1);
  });

  it('falls back to speed for rowing pace when power is absent', () => {
    const s = createSeries({
      source: 'x',
      t: [0, 1],
      channels: { speed: [4, 4] },
    });
    expect(downsample(s, 'erg')[0].pace).toBeCloseTo(125);
  });

  it('works on the irregular non-Strava series', () => {
    const rows = downsample(captureSeries(), 'erg');
    // Eight samples and one pause: eight rows and one gap row.
    expect(rows.filter((r) => !isGap(r))).toHaveLength(8);
    expect(rows.filter(isGap)).toHaveLength(1);
  });
});

describe('seriesExtras', () => {
  it('computes max power, max heart rate, average rate and work over moving intervals', () => {
    const e = seriesExtras(steady(101));
    expect(e.maxWatts).toBe(200);
    expect(e.maxHr).toBe(140);
    expect(e.avgRate).toBe(24);
    // 100 one-second intervals at 200 W.
    expect(e.workKj).toBe(20);
  });

  it('leaves a pause out of every extra', () => {
    const s = createSeries({
      source: 'x',
      t: [0, 1, 2, 3],
      channels: {
        watts: [100, 900, 100, 100],
        hr: [120, 190, 120, 120],
        moving: [1, 0, 1, 1],
      },
    });
    const e = seriesExtras(s);
    expect(e.maxWatts).toBe(100);
    expect(e.maxHr).toBe(120);
    expect(e.workKj).toBe(0.2);
  });

  it('is null where the series cannot support a value', () => {
    expect(seriesExtras(createSeries({ source: 'x', t: [0, 1, 2] }))).toEqual({
      maxWatts: null,
      maxHr: null,
      avgRate: null,
      workKj: null,
    });
    expect(
      seriesExtras(
        createSeries({ source: 'x', t: [0], channels: { watts: [300] } })
      ).maxWatts
    ).toBeNull();
  });

  it('works on the irregular non-Strava series', () => {
    const e = seriesExtras(captureSeries());
    expect(e.maxWatts).toBe(220);
    // The last sample (141 bpm) opens no interval.
    expect(e.maxHr).toBe(140);
    expect(e.avgRate).toBeGreaterThan(24);
  });
});

describe('downsample: a grouped run reaches its end', () => {
  it('draws the closing sample of every run above maxPoints', () => {
    // 1801 samples, 1 s apart, a 61 s pause in the middle: two runs, grouped.
    const t = [];
    for (let i = 0; i < 1801; i += 1) t.push(i < 900 ? i : i + 60);
    const s = createSeries({
      source: 'x',
      t,
      channels: { watts: t.map((_, i) => (i < 900 ? 150 : 250)) },
    });
    const rows = downsample(s, 'cycling', 600);
    expect(rows.length).toBeLessThanOrEqual(600);
    // The first run ends at sample 899, the second at the last sample.
    expect(rows.filter((r) => !isGap(r)).some((r) => r.x === 899)).toBe(true);
    expect(rows.at(-1).x).toBe(t.at(-1));
    // The closing row carries the closing sample's own value.
    expect(rows.at(-1).watts).toBe(250);
  });

  it('a grouped row spans its group, x to xEnd; a per-sample row is one instant', () => {
    const rows = downsample(steady(1801), 'erg', 600);
    const groups = rows.filter((r) => r.xEnd != null);
    // 1800 intervals in groups of four; each ends where the next begins.
    expect(groups[0]).toMatchObject({ x: 0, xEnd: 4 });
    for (let k = 1; k < groups.length; k += 1) {
      expect(groups[k].x).toBe(groups[k - 1].xEnd);
    }
    expect(groups.at(-1).xEnd).toBe(1800);
    expect(downsample(steady(600), 'erg', 600).some((r) => 'xEnd' in r)).toBe(
      false
    );
  });

  it('keeps a single long run within maxPoints with its closing row', () => {
    const rows = downsample(steady(3 * 3600), 'erg', 600);
    expect(rows.length).toBeLessThanOrEqual(600);
    expect(rows.at(-1).x).toBe(3 * 3600 - 1);
  });
});

describe('indexRangeForTimes', () => {
  const s = createSeries({ source: 'x', t: [0, 1, 2.5, 4, 10, 11] });

  it('covers the asked times: at or before the start, at or after the end', () => {
    expect(indexRangeForTimes(s, 1, 4)).toEqual({ i0: 1, i1: 3 });
    expect(indexRangeForTimes(s, 1.2, 3)).toEqual({ i0: 1, i1: 3 });
  });

  it('orders and clamps', () => {
    expect(indexRangeForTimes(s, 4, 1)).toEqual({ i0: 1, i1: 3 });
    expect(indexRangeForTimes(s, -5, 50)).toEqual({ i0: 0, i1: 5 });
  });

  it('works on an offset clock', () => {
    const late = createSeries({ source: 'x', t: [100, 101, 102, 103] });
    expect(indexRangeForTimes(late, 101, 102)).toEqual({ i0: 1, i1: 2 });
  });
});

describe('distanceSplits', () => {
  it('names its split distances', () => {
    expect(ROWING_SPLIT_M).toBe(500);
    expect(CYCLING_SPLIT_M).toBe(5000);
    expect(ROWING_SPLIT_OPTIONS).toEqual([500, 1000, 2000]);
  });

  it('splits a steady row every 500 m with a partial last split, always shown', () => {
    // 4 m/s for 299 s: 1196 m, so 500, 500 and a partial 196.
    const splits = distanceSplits(steady(300), 'erg', 500);
    expect(splits.map((x) => x.distanceM)).toEqual([500, 500, 196]);
    expect(splits.map((x) => x.partial)).toEqual([false, false, true]);
    expect(splits[0]).toMatchObject({
      index: 0,
      i0: 0,
      i1: 125,
      startS: 0,
      endS: 125,
      movingS: 125,
      elapsedS: 125,
      avgWatts: 200,
      avgHr: 140,
      avgRate: 24,
    });
    expect(splits[0].pace500).toBeCloseTo(125);
    expect(splits[2].endS).toBe(299);
  });

  it('interpolates a boundary between samples and prorates the interval it cuts', () => {
    // A sample every 10 s, 40 m apart: 500 m falls 5 s into 120..130 s.
    const s = steady(31, 10);
    const [first, second] = distanceSplits(s, 'erg', 500);
    expect(first.endS).toBeCloseTo(125);
    expect(first.movingS).toBeCloseTo(125);
    expect(first.i0).toBe(0);
    // The enclosing samples, 0..13 (130 s): what selecting the split uses.
    expect(first.i1).toBe(13);
    expect(second.startS).toBeCloseTo(125);
    expect(second.movingS).toBeCloseTo(125);
    expect(second.i0).toBe(12);
    const sel = rangeStats(s, 'erg', first.i0, first.i1);
    expect(first.avgWatts).toBe(sel.avgWatts);
    expect(first.avgHr).toBe(sel.avgHr);
  });

  it('a whole number of splits leaves no partial row', () => {
    const splits = distanceSplits(steady(251), 'erg', 500); // 1000 m
    expect(splits).toHaveLength(2);
    expect(splits.every((x) => !x.partial)).toBe(true);
  });

  it('gives a ride speed, and [] without a distance channel', () => {
    const [first] = distanceSplits(steady(3000), 'cycling', 5000);
    expect(first.speedKmh).toBeCloseTo(14.4);
    expect(first.pace500).toBeNull();
    const noDist = createSeries({
      source: 'x',
      t: [0, 1, 2],
      channels: { watts: [1, 2, 3] },
    });
    expect(distanceSplits(noDist, 'erg', 500)).toEqual([]);
  });

  it('leaves a pause out of a split’s time and averages', () => {
    const s = createSeries({
      source: 'x',
      t: [0, 50, 100, 400, 450],
      channels: {
        watts: [200, 200, 999, 200, 200],
        dist: [0, 200, 400, 400, 600],
      },
    });
    const [first, last] = distanceSplits(s, 'erg', 500);
    // 500 m is 25 s into the last interval: 125 s moving, the 300 s stop out.
    expect(first.movingS).toBeCloseTo(125);
    expect(first.elapsedS).toBeCloseTo(425);
    expect(first.avgWatts).toBe(200);
    expect(last).toMatchObject({ partial: true, distanceM: 100 });
  });

  it('works on the irregular, per-stroke series', () => {
    const s = captureSeries();
    // 65 m in 10 m splits: six full and a partial 5 m.
    const splits = distanceSplits(s, 'erg', 10);
    expect(splits).toHaveLength(7);
    expect(splits[6]).toMatchObject({ partial: true, distanceM: 5 });
    // 50 to 60 m spans the 18 s pause, which counts nowhere: 60 m falls
    // halfway into the 2.5 s interval from 55 to 65 m.
    expect(splits[5].movingS).toBeCloseTo(1.25);
    const total = splits.reduce((a, x) => a + x.movingS, 0);
    expect(total).toBeCloseTo(rangeStats(s, 'erg').movingS);
  });
});

describe('lapSplits', () => {
  const laps = (list) =>
    createSeries({
      source: 'x',
      t: Array.from({ length: 11 }, (_, i) => i * 10),
      channels: {
        watts: Array(11).fill(250),
        dist: Array.from({ length: 11 }, (_, i) => i * 80),
      },
      laps: list,
    });

  it('one split per lap, when there is more than one', () => {
    const splits = lapSplits(
      laps([
        { i0: 0, i1: 4 },
        { i0: 4, i1: 10 },
      ]),
      'cycling'
    );
    expect(splits).toHaveLength(2);
    expect(splits[0]).toMatchObject({
      index: 0,
      i0: 0,
      i1: 4,
      startS: 0,
      endS: 40,
      distanceM: 320,
      avgWatts: 250,
      partial: false,
    });
    expect(splits[1].speedKmh).toBeCloseTo(28.8);
  });

  it('a single lap is the whole session again: []', () => {
    expect(lapSplits(laps([{ i0: 0, i1: 10 }]), 'cycling')).toEqual([]);
    expect(lapSplits(laps([]), 'cycling')).toEqual([]);
  });
});
