import { describe, it, expect } from 'vitest';
import * as trainingConfig from '../trainingConfig.js';
import { THEME } from '../theme.js';
import { ZONE_POWER_PCT } from '../zonePowerPct.js';
import { FTP_TEST, derivePaceZones } from '../trainingConfig.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Names built by concatenation so this file does not trip noCulledCode.test.js.
const REMOVED = [
  'CALIBRATION' + '_STATUS',
  'deriveCalibration' + 'Status',
  'CRITICAL' + '_POWER',
  'POWER' + '_DURATION',
  'HR' + '_ZONES',
  'EST' + '_MHR',
  'HR130' + '_POWER',
  'SRPE' + '_SCALE',
];

describe('CP is never mirrored as a static constant', () => {
  it('exports no static PACE_ZONES that could diverge from the live bands', () => {
    expect(trainingConfig).not.toHaveProperty('PACE_ZONES');
  });

  it('the CP test card carries no past-dated "when"', () => {
    expect(FTP_TEST.when).not.toMatch(/Jun|Jul/);
  });
});

describe('personal calibration is removed (#422)', () => {
  it.each(REMOVED)('%s is no longer exported', (name) => {
    expect(trainingConfig[name]).toBeUndefined();
  });

  // The CP test card renders verbatim on ErgView: no status claim that can
  // contradict the anchor, no one rower's setup or habits, no promise of a
  // view this slice deleted.
  it('the CP test card is generic', () => {
    const text = Object.values(FTP_TEST).join(' ');
    expect(text).not.toMatch(
      /overdue|\bDF ?\d|caffeine|cannabis|projection|power-duration|W'/i
    );
  });
});

describe('derivePaceZones', () => {
  it('scales the bands with the CP it is given', () => {
    const at190 = derivePaceZones(190).find((z) => z.zone === 'AT');
    const at205 = derivePaceZones(205).find((z) => z.zone === 'AT');
    expect(at205.wattsLow).toBeGreaterThan(at190.wattsLow);
    expect(at205.wattsHigh).toBeGreaterThan(at190.wattsHigh);
  });

  it('puts UT2/UT1/AT where the live 205W anchor implies', () => {
    const zones = derivePaceZones(205);
    const band = (z) => {
      const found = zones.find((x) => x.zone === z);
      return [found.wattsLow, found.wattsHigh];
    };
    expect(band('UT2')).toEqual([113, 144]);
    expect(band('UT1')).toEqual([144, 164]);
    expect(band('AT')).toEqual([164, 185]);
  });

  it('keeps the pre-#422 watt and pace bands at 205 W', () => {
    const zones = derivePaceZones(205);
    expect(zones.map(({ color: _c, ...rest }) => rest)).toEqual([
      {
        zone: 'Recovery',
        wattsLow: 0,
        wattsHigh: 113,
        paceFloor: 145.7683373800698,
        paceCeil: 300,
      },
      {
        zone: 'UT2',
        wattsLow: 113,
        wattsHigh: 144,
        paceFloor: 134.452387168712,
        paceCeil: 145.7683373800698,
      },
      {
        zone: 'UT1',
        wattsLow: 144,
        wattsHigh: 164,
        paceFloor: 128.74826901045958,
        paceCeil: 134.452387168712,
      },
      {
        zone: 'AT',
        wattsLow: 164,
        wattsHigh: 185,
        paceFloor: 123.67979934387759,
        paceCeil: 128.74826901045958,
      },
      {
        zone: 'TR',
        wattsLow: 185,
        wattsHigh: 215,
        paceFloor: 117.6367980107184,
        paceCeil: 123.67979934387759,
      },
      {
        zone: 'AN',
        wattsLow: 215,
        wattsHigh: 267,
        paceFloor: 109.44239648589375,
        paceCeil: 117.6367980107184,
      },
    ]);
  });

  it('derivePaceZones reads colours and bounds from ZONE_POWER_PCT', () => {
    const zones = derivePaceZones(200);
    expect(zones.map((z) => z.zone)).toEqual(ZONE_POWER_PCT.map((z) => z.zone));
    expect(zones.map((z) => z.color)).toEqual(
      ZONE_POWER_PCT.map((z) => z.color)
    );
  });
});

describe('Recovery colour is a THEME token (#819)', () => {
  it('ZONE_POWER_PCT Recovery uses THEME.zoneRecovery, not a hex', () => {
    const recovery = ZONE_POWER_PCT.find((z) => z.zone === 'Recovery');
    expect(recovery.color).toBe(THEME.zoneRecovery);
    expect(recovery.color).toBe('var(--color-zone-recovery)');
    expect(recovery.color).not.toMatch(/#/);
  });

  it('trainingConfig.js no longer writes the Recovery hex or the zone table', () => {
    const src = readFileSync(
      join(import.meta.dirname, '../trainingConfig.js'),
      'utf8'
    );
    expect(src).not.toMatch(/#666/);
    expect(src).not.toMatch(/const ZONE_POWER_PCT/);
    expect(src).toMatch(/from '\.\/zonePowerPct\.js'/);
  });
});
