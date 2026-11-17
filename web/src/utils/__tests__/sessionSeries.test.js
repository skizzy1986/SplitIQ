import {
  MAX_SAMPLE_S,
  createSeries,
  downsample,
  rangeStats,
  seriesExtras,
} from '../sessionSeries.js';
import { wattsToPace500 } from '../pace.js';
import { captureSeries } from '../../test/sessionFixtures.js';

// Every series here is synthetic: invented numbers, no real session.
const steady = (n, watts = 200) =>
  createSeries({
    source: 'test',
    t: Array.from({ length: n }, (_, i) => i),
    channels: {
      watts: Array(n).fill(watts),
      hr: Array(n).fill(140),
      rate: Array(n).fill(24),
      dist: Array.from({ length: n }, (_, i) => i * 4),
    },
  });

describe('createSeries', () => {
  it('computes n, the per-sample durations and what the series has', () => {
    const s = createSeries({
      source: 'test',
      t: [0, 1, 3, 20, 21],
      channels: { watts: [100, null, 120, 130, 140], hr: [0, 0, 0, 0, 0] },
    });
    expect(s.n).toBe(5);
    // Gaps over MAX_SAMPLE_S are capped; the last sample takes the median.
    expect(s.dt).toEqual([1, 2, MAX_SAMPLE_S, 1, 1.5]);
    expect(s.has).toEqual({
      power: true,
      hr: false,
      rate: false,
      distance: false,
    });
    expect(s.channels.rate).toBeNull();
    expect(s.info).toMatchObject({ elapsedS: null, ref: null });
  });

  it('gives a single sample a duration of one second', () => {
    expect(createSeries({ source: 'x', t: [5] }).dt).toEqual([1]);
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
});

describe('rangeStats', () => {
  it('computes the whole session of a steady row', () => {
    const s = steady(601);
    const r = rangeStats(s, 'erg');
    expect(r.elapsedS).toBe(600);
    expect(r.movingS).toBe(601);
    expect(r.distanceM).toBe(2400);
    expect(r.avgWatts).toBe(200);
    expect(r.avgHr).toBe(140);
    expect(r.avgRate).toBe(24);
    expect(r.pace500).toBeCloseTo((500 * 601) / 2400);
    expect(r.speedKmh).toBeNull();
  });

  it('counts only moving samples, keeps power zeros and drops heart-rate zeros', () => {
    const s = createSeries({
      source: 'x',
      t: [0, 1, 2, 3, 4],
      channels: {
        watts: [100, 0, 200, 300, 999],
        hr: [120, 0, 140, 160, 200],
        moving: [true, true, true, true, false],
      },
    });
    const r = rangeStats(s, 'erg');
    expect(r.movingS).toBe(4);
    expect(r.avgWatts).toBe(150);
    expect(r.avgHr).toBe(140);
    expect(r.distanceM).toBeNull();
    // No distance: pace falls back to average power.
    expect(r.pace500).toBeCloseTo(wattsToPace500(150));
  });

  it('time-weights an irregular, per-stroke series and caps the pause', () => {
    const s = captureSeries();
    const r = rangeStats(s, 'erg');
    const dt = s.dt;
    expect(dt[5]).toBe(MAX_SAMPLE_S);
    const watts = [180, 200, 220, 210, 190, 0, 200, 205];
    const expected =
      watts.reduce((a, w, i) => a + w * dt[i], 0) / dt.reduce((a, b) => a + b);
    expect(r.avgWatts).toBeCloseTo(expected);
    expect(r.distanceM).toBe(65);
    expect(r.elapsedS).toBe(32.5);
  });

  it('gives cycling speed from distance and moving time, and a sub-range', () => {
    const s = steady(11);
    expect(rangeStats(s, 'cycling').speedKmh).toBeCloseTo((40 / 11) * 3.6);
    const part = rangeStats(s, 'erg', 2, 5);
    expect(part).toMatchObject({ i0: 2, i1: 5, elapsedS: 3, distanceM: 12 });
    // Out-of-range and reversed indices are clamped and ordered.
    expect(rangeStats(s, 'erg', 50, -3)).toMatchObject({ i0: 0, i1: 10 });
  });
});

describe('downsample', () => {
  it('draws at most maxPoints rows from a long series', () => {
    const rows = downsample(steady(3 * 3600), 'erg', 600);
    expect(rows).toHaveLength(600);
    expect(rows[0].x).toBe(0);
    expect(rows[0].watts).toBe(200);
    expect(rows[0].pace).toBeCloseTo(wattsToPace500(200));
  });

  it('leaves a gap as null so it draws as a gap', () => {
    const s = createSeries({
      source: 'x',
      t: [0, 1, 2, 100, 101],
      channels: { watts: [100, 100, 100, 200, 200] },
    });
    const rows = downsample(s, 'cycling', 10);
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.watts == null)).toBe(true);
    expect(rows[0].watts).toBe(100);
    expect(rows.at(-1).watts).toBe(200);
    expect(rows[0].pace).toBeNull();
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
    const rows = downsample(captureSeries(), 'erg', 4);
    expect(rows).toHaveLength(4);
    expect(rows[0].hr).toBeGreaterThan(0);
  });
});

describe('seriesExtras', () => {
  it('computes max power, max heart rate, average rate and work', () => {
    const e = seriesExtras(steady(101));
    expect(e.maxWatts).toBe(200);
    expect(e.maxHr).toBe(140);
    expect(e.avgRate).toBe(24);
    expect(e.workKj).toBeCloseTo((200 * 101) / 1000);
  });

  it('is null where the series cannot support a value', () => {
    const e = seriesExtras(createSeries({ source: 'x', t: [0, 1, 2] }));
    expect(e).toEqual({
      maxWatts: null,
      maxHr: null,
      avgRate: null,
      workKj: null,
    });
  });

  it('works on the irregular non-Strava series', () => {
    const e = seriesExtras(captureSeries());
    expect(e.maxWatts).toBe(220);
    expect(e.maxHr).toBe(141);
    expect(e.avgRate).toBeGreaterThan(24);
  });
});
