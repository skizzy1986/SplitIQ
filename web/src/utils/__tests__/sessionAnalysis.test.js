import {
  MIN_ANALYSIS_S,
  MIN_COVERAGE,
  PEAK_WINDOWS,
  aerobicDrift,
  analysisNeeds,
  dominantZone,
  normalizedPower,
  peakPowers,
  timeInZones,
  variabilityIndex,
} from '../sessionAnalysis.js';
import { createSeries } from '../sessionSeries.js';
import {
  deriveCyclingZones,
  derivePaceZones,
} from '../../constants/trainingConfig.js';
import { captureSeries } from '../../test/sessionFixtures.js';

// One 1 s interval per listed value: a closing sample is appended, because
// the last sample of a series opens no interval.
const series = (watts, moving) =>
  createSeries({
    source: 'test',
    t: [...watts.map((_, i) => i), watts.length],
    channels: {
      watts: [...watts, null],
      moving: moving ? [...moving, 1] : undefined,
    },
  });

describe('timeInZones', () => {
  it('bins rowing power into [low, high) bands, top band open', () => {
    // CP 200: UT2 110-140, UT1 140-160, AN 210 and up.
    const zones = derivePaceZones(200);
    const r = timeInZones(series([110, 139, 140, 300, 1000, 0]), zones);
    const by = Object.fromEntries(r.bands.map((b) => [b.key, b.seconds]));
    expect(by.UT2).toBe(2);
    expect(by.UT1).toBe(1);
    // 300 W is above the AN ceiling (260 W) and still counts as AN.
    expect(by.AN).toBe(2);
    expect(by.Recovery).toBe(1);
    expect(r.zonedS).toBe(6);
    expect(r.unpoweredS).toBe(0);
    expect(r.bands.reduce((a, b) => a + b.fraction, 0)).toBeCloseTo(1);
  });

  it('bins cycling power into the seven levels', () => {
    const r = timeInZones(series([100, 160, 320]), deriveCyclingZones(200));
    const by = Object.fromEntries(r.bands.map((b) => [b.key, b.seconds]));
    expect(by).toMatchObject({
      active_recovery: 1,
      tempo: 1,
      neuromuscular: 1,
    });
    expect(r.bands[0]).toMatchObject({ zone: 'Z1', key: 'active_recovery' });
  });

  it('counts moving samples only, and moving samples without power apart', () => {
    const r = timeInZones(
      series([150, null, 150, 150], [true, true, false, true]),
      derivePaceZones(200)
    );
    expect(r.zonedS).toBe(2);
    expect(r.unpoweredS).toBe(1);
  });

  it('is null without a series or zones', () => {
    expect(timeInZones(null, derivePaceZones(200))).toBeNull();
    expect(timeInZones(series([1]), null)).toBeNull();
  });

  it('works on the irregular non-Strava series', () => {
    const s = captureSeries();
    const r = timeInZones(s, derivePaceZones(200));
    // Every moving interval, and the 18 s pause in none.
    const moving = s.dt.reduce((a, d, i) => (s.live[i] ? a + d : a), 0);
    expect(r.zonedS).toBeCloseTo(moving);
    expect(r.zonedS).toBeCloseTo(14.5);
    expect(r.unpoweredS).toBe(0);
    expect(r.bands.find((b) => b.key === 'TR').seconds).toBeGreaterThan(0);
  });
});

describe('dominantZone', () => {
  it('names a zone only when it holds more than half the zoned time', () => {
    const zones = derivePaceZones(200);
    expect(
      dominantZone(timeInZones(series([120, 120, 120, 150]), zones)).key
    ).toBe('UT2');
    expect(
      dominantZone(timeInZones(series([120, 120, 150, 150]), zones))
    ).toBeNull();
    expect(dominantZone(null)).toBeNull();
  });
});

// Synthetic, `step` s apart: watts(i) and hr(i) per sample.
const trace = (n, watts, hr = () => 140, step = 1) =>
  createSeries({
    source: 'test',
    t: Array.from({ length: n }, (_, i) => i * step),
    channels: {
      watts: Array.from({ length: n }, (_, i) => watts(i)),
      hr: Array.from({ length: n }, (_, i) => hr(i)),
    },
  });

describe('analysis constants', () => {
  it('are named, and what the spec says', () => {
    expect(MIN_ANALYSIS_S).toBe(1200);
    expect(MIN_COVERAGE).toBe(0.8);
    expect(PEAK_WINDOWS).toEqual([60, 300, 1200]);
  });
});

describe('peakPowers', () => {
  it('a steady session peaks at its own power over every window', () => {
    const peaks = peakPowers(trace(1801, () => 200));
    expect(peaks.map((p) => p.windowS)).toEqual([60, 300, 1200]);
    for (const p of peaks) {
      expect(p.watts).toBeCloseTo(200);
      expect(p.needs).toBeNull();
    }
  });

  it('finds the hardest stretch of each length', () => {
    // 100 W, with 400 W from 600 to 660 s.
    const peaks = peakPowers(
      trace(1801, (i) => (i >= 600 && i < 660 ? 400 : 100))
    );
    expect(peaks[0].watts).toBeCloseTo(400);
    expect(peaks[1].watts).toBeCloseTo((60 * 400 + 240 * 100) / 300);
  });

  it('counts a pause as 0 W', () => {
    // 300 W for 600 s, a 600 s stop with no samples, 300 W for 600 s.
    const t = [];
    for (let i = 0; i <= 600; i += 1) t.push(i);
    for (let i = 1200; i <= 1800; i += 1) t.push(i);
    const s = createSeries({
      source: 'test',
      t,
      channels: { watts: t.map(() => 300) },
    });
    const [one, five, twenty] = peakPowers(s);
    expect(one.watts).toBeCloseTo(300);
    expect(five.watts).toBeCloseTo(300);
    // Any 20 min holds at most 10 min of riding.
    expect(twenty.watts).toBeCloseTo(150);
  });

  it('is null when the session is shorter than the window, or has no power', () => {
    const [one, five, twenty] = peakPowers(trace(601, () => 200));
    expect(one.watts).toBeCloseTo(200);
    expect(five.watts).toBeCloseTo(200);
    expect(twenty).toEqual({ windowS: 1200, watts: null, needs: 'duration' });
    const unpowered = createSeries({
      source: 'test',
      t: Array.from({ length: 1801 }, (_, i) => i),
      channels: { hr: Array(1801).fill(140) },
    });
    expect(peakPowers(unpowered).every((p) => p.needs === 'power')).toBe(true);
  });
});

describe('normalizedPower and variabilityIndex', () => {
  it('a constant series: weighted power is the constant, variability 1', () => {
    const s = trace(1801, () => 250);
    expect(normalizedPower(s)).toBeCloseTo(250);
    const v = variabilityIndex(s);
    expect(v.avg).toBeCloseTo(250);
    expect(v.vi).toBeCloseTo(1);
  });

  it('an uneven series weighs above its average', () => {
    // Alternating minutes at 300 W and 100 W: average 200 W.
    const s = trace(1801, (i) => (Math.floor(i / 60) % 2 ? 100 : 300));
    const v = variabilityIndex(s);
    expect(v.avg).toBeCloseTo(200, 0);
    expect(v.np).toBeGreaterThan(v.avg);
    expect(v.vi).toBeCloseTo(v.np / v.avg);
    expect(normalizedPower(s)).toBe(v.np);
  });

  it('is null under 20 min of moving time', () => {
    const s = trace(1000, () => 250);
    expect(normalizedPower(s)).toBeNull();
    expect(variabilityIndex(s)).toBeNull();
    expect(analysisNeeds(s).variability).toBe('duration');
  });

  it('is null with power for under 80% of the moving time', () => {
    const s = trace(1801, (i) => (i % 10 < 3 ? null : 250));
    expect(normalizedPower(s)).toBeNull();
    expect(variabilityIndex(s)).toBeNull();
    expect(analysisNeeds(s)).toEqual({ variability: 'power', drift: 'power' });
  });
});

describe('a session of zero power', () => {
  it('needs power, not heart rate, and shows no zero peak', () => {
    const s = trace(1801, () => 0);
    expect(analysisNeeds(s)).toEqual({ variability: 'power', drift: 'power' });
    expect(variabilityIndex(s)).toBeNull();
    expect(aerobicDrift(s)).toBeNull();
    expect(peakPowers(s).map((p) => [p.watts, p.needs])).toEqual([
      [null, 'power'],
      [null, 'power'],
      [null, 'power'],
    ]);
  });
});

describe('aerobicDrift', () => {
  it('compares power per beat in the two halves of moving time', () => {
    const s = trace(
      1801,
      () => 200,
      (i) => (i < 900 ? 140 : 150)
    );
    const d = aerobicDrift(s);
    expect(d.firstRatio).toBeCloseTo(200 / 140);
    expect(d.secondRatio).toBeCloseTo(200 / 150);
    expect(d.driftPct).toBeCloseTo((1 - 140 / 150) * 100);
    expect(analysisNeeds(s)).toEqual({ variability: null, drift: null });
  });

  it('is null without heart rate for 80% of either half', () => {
    const s = trace(
      1801,
      () => 200,
      (i) => (i < 900 ? 140 : i % 2 ? 0 : 150)
    );
    expect(aerobicDrift(s)).toBeNull();
    expect(analysisNeeds(s).drift).toBe('hr');
    // Variability needs no heart rate.
    expect(variabilityIndex(s)).not.toBeNull();
  });

  it('is null under 20 min of moving time or without power', () => {
    expect(aerobicDrift(trace(1000, () => 200))).toBeNull();
    expect(aerobicDrift(trace(1801, () => null))).toBeNull();
  });
});

describe('analysis on an irregular, per-stroke series', () => {
  // A stroke every 2.2 to 2.8 s for about 25 min at 200 W, heart rate rising
  // from 140 to 150 halfway.
  const strokes = () => {
    const t = [0];
    while (t.at(-1) < 1500) t.push(t.at(-1) + 2.2 + (t.length % 4) * 0.2);
    return createSeries({
      source: 'capture',
      sampling: 'stroke',
      t,
      channels: {
        watts: t.map(() => 200),
        hr: t.map((x) => (x < 750 ? 140 : 150)),
      },
    });
  };

  it('time-weights every figure', () => {
    const s = strokes();
    expect(normalizedPower(s)).toBeCloseTo(200);
    expect(variabilityIndex(s).vi).toBeCloseTo(1);
    expect(peakPowers(s).map((p) => Math.round(p.watts))).toEqual([
      200, 200, 200,
    ]);
    expect(aerobicDrift(s).driftPct).toBeCloseTo((1 - 140 / 150) * 100, 0);
  });

  it('the short capture fixture supports none of them, and says why', () => {
    const s = captureSeries();
    expect(peakPowers(s).every((p) => p.needs === 'duration')).toBe(true);
    expect(variabilityIndex(s)).toBeNull();
    expect(aerobicDrift(s)).toBeNull();
    expect(analysisNeeds(s)).toEqual({
      variability: 'duration',
      drift: 'duration',
    });
  });
});
