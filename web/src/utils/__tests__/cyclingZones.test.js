import {
  deriveCyclingZones,
  derivePaceZones,
} from '../../constants/trainingConfig.js';
import { THEME } from '../../constants/theme.js';

describe('deriveCyclingZones', () => {
  it("gives Coggan's seven levels as fractions of FTP", () => {
    const zones = deriveCyclingZones(200);
    expect(zones.map((z) => z.zone)).toEqual([
      'Z1',
      'Z2',
      'Z3',
      'Z4',
      'Z5',
      'Z6',
      'Z7',
    ]);
    expect(zones.map((z) => z.key)).toEqual([
      'active_recovery',
      'endurance',
      'tempo',
      'threshold',
      'vo2max',
      'anaerobic',
      'neuromuscular',
    ]);
    expect(zones.map((z) => [z.wattsLow, z.wattsHigh])).toEqual([
      [0, 110],
      [110, 150],
      [150, 180],
      [180, 210],
      [210, 240],
      [240, 300],
      [300, null],
    ]);
    expect(zones.map((z) => z.pctLow)).toEqual([
      0, 0.55, 0.75, 0.9, 1.05, 1.2, 1.5,
    ]);
    expect(zones.at(-1).pctHigh).toBeNull();
  });

  it('is contiguous: each band starts where the last ended', () => {
    const zones = deriveCyclingZones(263);
    for (let i = 1; i < zones.length; i += 1) {
      expect(zones[i].wattsLow).toBe(zones[i - 1].wattsHigh);
    }
  });

  it('reads every colour from THEME', () => {
    expect(deriveCyclingZones(250).map((z) => z.color)).toEqual([
      THEME.muted,
      THEME.accent,
      THEME.positive,
      THEME.caution,
      THEME.warning,
      THEME.critical,
      THEME.accentAlt2,
    ]);
  });

  it('leaves derivePaceZones unchanged', () => {
    expect(derivePaceZones(200).map((z) => z.zone)).toEqual([
      'Recovery',
      'UT2',
      'UT1',
      'AT',
      'TR',
      'AN',
    ]);
  });
});
