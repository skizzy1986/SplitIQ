import {
  PAUSE_MEDIAN_FACTOR,
  PAUSE_MIN_S,
  createSeries,
  downsample,
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
    expect(s.pauseThresholdS).toBeNull();
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
