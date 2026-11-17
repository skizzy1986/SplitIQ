import { dominantZone, timeInZones } from '../sessionAnalysis.js';
import { createSeries } from '../sessionSeries.js';
import {
  deriveCyclingZones,
  derivePaceZones,
} from '../../constants/trainingConfig.js';
import { captureSeries } from '../../test/sessionFixtures.js';

const series = (watts, moving) =>
  createSeries({
    source: 'test',
    t: watts.map((_, i) => i),
    channels: { watts, moving },
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
    expect(r.zonedS).toBeCloseTo(s.dt.reduce((a, b) => a + b));
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
