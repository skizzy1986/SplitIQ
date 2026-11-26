import { describe, it, expect } from 'vitest';
import { THEME } from '../theme.js';
import { ZONE_POWER_PCT } from '../zonePowerPct.js';

describe('ZONE_POWER_PCT', () => {
  it('is a contiguous half-open ladder of the six rowing zones', () => {
    expect(ZONE_POWER_PCT.map((z) => z.zone)).toEqual([
      'Recovery',
      'UT2',
      'UT1',
      'AT',
      'TR',
      'AN',
    ]);
    expect(ZONE_POWER_PCT[0].pctLow).toBe(0);
    for (let i = 0; i < ZONE_POWER_PCT.length - 1; i++) {
      expect(ZONE_POWER_PCT[i].pctHigh).toBe(ZONE_POWER_PCT[i + 1].pctLow);
    }
  });

  it('paints every band with a THEME token', () => {
    const tokens = new Set(Object.values(THEME));
    for (const band of ZONE_POWER_PCT) {
      expect(tokens.has(band.color), band.zone).toBe(true);
      expect(band.color).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
  });
});
