import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZONE_POWER_PCT } from '../../constants/zonePowerPct.js';
import {
  wattsToPace500,
  pace500ToWatts,
  formatPace,
  classifyZone,
} from '../pace.js';

describe('wattsToPace500', () => {
  it('converts 190W to ~122.6 s/500m', () => {
    expect(wattsToPace500(190)).toBeCloseTo(122.6, 1);
  });
  it('converts 150W to ~132.6 s/500m', () => {
    expect(wattsToPace500(150)).toBeCloseTo(132.6, 1);
  });
});

describe('pace500ToWatts', () => {
  it('round-trips with wattsToPace500', () => {
    expect(pace500ToWatts(wattsToPace500(190))).toBeCloseTo(190, 2);
  });
});

describe('formatPace', () => {
  it('formats 138.5 as 2:18.5', () => {
    expect(formatPace(138.5)).toBe('2:18.5');
  });
  it('formats 125.1 as 2:05.1', () => {
    expect(formatPace(125.1)).toBe('2:05.1');
  });
  it('returns — for null', () => {
    expect(formatPace(null)).toBe('—');
  });
  it('returns — for 0', () => {
    expect(formatPace(0)).toBe('—');
  });
  it('returns — for NaN', () => {
    expect(formatPace(NaN)).toBe('—');
  });
  it('returns — for undefined', () => {
    expect(formatPace(undefined)).toBe('—');
  });
});

describe('classifyZone', () => {
  const cp = 190;
  it('returns null when watts is null', () => {
    expect(classifyZone(null, cp)).toBe(null);
  });
  it('returns null when watts is undefined', () => {
    expect(classifyZone(undefined, cp)).toBe(null);
  });
  it('classifies Recovery below 55%', () => {
    expect(classifyZone(100, cp)).toBe('Recovery');
  });
  it('classifies the UT2 lower boundary (55%)', () => {
    expect(classifyZone(0.55 * cp, cp)).toBe('UT2');
  });
  it('classifies UT2 mid-band', () => {
    expect(classifyZone(120, cp)).toBe('UT2');
  });
  it('classifies the UT1 lower boundary (70%)', () => {
    expect(classifyZone(0.7 * cp, cp)).toBe('UT1');
  });
  it('classifies UT1 mid-band', () => {
    expect(classifyZone(145, cp)).toBe('UT1');
  });
  it('classifies the AT lower boundary (80%)', () => {
    expect(classifyZone(0.8 * cp, cp)).toBe('AT');
  });
  it('classifies AT mid-band', () => {
    expect(classifyZone(165, cp)).toBe('AT');
  });
  it('classifies the TR lower boundary (90%)', () => {
    expect(classifyZone(0.9 * cp, cp)).toBe('TR');
  });
  it('classifies TR at exactly 100% CP', () => {
    expect(classifyZone(190, cp)).toBe('TR');
  });
  it('classifies the AN lower boundary (105%)', () => {
    expect(classifyZone(1.05 * cp, cp)).toBe('AN');
  });
  it('classifies AN above 105%', () => {
    expect(classifyZone(220, cp)).toBe('AN');
  });
});

describe('classifyZone reads ZONE_POWER_PCT (#819)', () => {
  const cp = 200;

  it('classifies each half-open band from the shared table', () => {
    for (let i = 0; i < ZONE_POWER_PCT.length; i++) {
      const band = ZONE_POWER_PCT[i];
      const next = ZONE_POWER_PCT[i + 1];
      const mid = ((band.pctLow + band.pctHigh) / 2) * cp;
      expect(classifyZone(mid, cp), band.zone).toBe(band.zone);
      if (next) {
        expect(classifyZone(band.pctHigh * cp, cp), `${band.zone} high`).toBe(
          next.zone
        );
      } else {
        expect(classifyZone(band.pctHigh * cp, cp)).toBe(band.zone);
        expect(classifyZone((band.pctHigh + 0.5) * cp, cp)).toBe(band.zone);
      }
    }
  });

  it('pace.js does not hard-code the zone fractions', () => {
    const src = readFileSync(join(import.meta.dirname, '../pace.js'), 'utf8');
    expect(src).toMatch(/ZONE_POWER_PCT/);
    expect(src).not.toMatch(/0\.55|0\.7|0\.8|0\.9|1\.05/);
  });
});
