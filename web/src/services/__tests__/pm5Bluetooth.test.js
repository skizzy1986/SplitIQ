import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../utils/sentry.js', () => ({ captureError: vi.fn() }));

import { captureError } from '../../utils/sentry.js';
import {
  parsePace,
  formatElapsed,
  PM5WorkoutState,
  STALE_LIMIT_S,
  isWorkingState,
  isRestState,
  isEndState,
  parseGeneralStatus,
  parseAdditionalStatus1,
  parseAdditionalStatus2,
  parseRowingSummary,
  parseRowingStrokeData,
  parseAdditionalStrokeData,
  isNewerStroke,
  formatStrokeRatio,
  formatDriveLength,
  LBF_TO_N,
  mergeStatus,
  buildPM5Summary,
  summaryReference,
  SUMMARY_STALE_LIMIT_S,
  connectToPM5,
  subscribe,
  PM5_UNSUPPORTED,
} from '../pm5Bluetooth.js';

// ---------------------------------------------------------------------------
// Synthetic packet helpers
// ---------------------------------------------------------------------------
function makePacket(size, bytes = []) {
  const view = new DataView(new ArrayBuffer(size));
  bytes.forEach((b, i) => view.setUint8(i, b));
  return view;
}

function set3ByteLE(view, n, value) {
  view.setUint8(n, value & 0xff);
  view.setUint8(n + 1, (value >> 8) & 0xff);
  view.setUint8(n + 2, (value >> 16) & 0xff);
}

function setUint16LE(view, n, value) {
  view.setUint16(n, value, true);
}

// 0035 rowing stroke data. Raw units, so a test can plant a saturated 0xFF /
// 0xFFFF as the monitor sends it.
function strokePacket({
  t = 0,
  dist = 0,
  driveLen = 0,
  driveTime = 0,
  recovery = 0,
  strokeDist = 0,
  peak = 0,
  avg = 0,
  work = 0,
  count = 0,
  size = 20,
} = {}) {
  const v = new DataView(new ArrayBuffer(size));
  set3ByteLE(v, 0, t);
  set3ByteLE(v, 3, dist);
  v.setUint8(6, driveLen);
  v.setUint8(7, driveTime);
  setUint16LE(v, 8, recovery);
  setUint16LE(v, 10, strokeDist);
  setUint16LE(v, 12, peak);
  setUint16LE(v, 14, avg);
  setUint16LE(v, 16, work);
  setUint16LE(v, 18, count);
  return v;
}

// 0036 additional stroke data, at either size the two revisions use.
function addStrokePacket(
  {
    t = 0,
    power = 0,
    cal = 0,
    count = 0,
    projTime = 0,
    projDist = 0,
    projOther = 0,
  } = {},
  size = 18
) {
  const v = new DataView(new ArrayBuffer(size));
  set3ByteLE(v, 0, t);
  setUint16LE(v, 3, power);
  setUint16LE(v, 5, cal);
  setUint16LE(v, 7, count);
  set3ByteLE(v, 9, projTime);
  set3ByteLE(v, 12, projDist);
  if (size >= 18) set3ByteLE(v, 15, projOther);
  return v;
}

// ---------------------------------------------------------------------------
// parsePace
// ---------------------------------------------------------------------------
describe('parsePace', () => {
  it("returns '--:--' for 0", () => {
    expect(parsePace(0)).toBe('--:--');
  });

  it("returns '--:--' for undefined / falsy", () => {
    expect(parsePace(undefined)).toBe('--:--');
    expect(parsePace(null)).toBe('--:--');
  });

  it('converts 11800 (1:58.0) correctly', () => {
    expect(parsePace(11800)).toBe('1:58.0');
  });

  it('converts 12000 (2:00.0) correctly', () => {
    expect(parsePace(12000)).toBe('2:00.0');
  });

  it('converts 6000 (1:00.0) correctly', () => {
    expect(parsePace(6000)).toBe('1:00.0');
  });

  it('handles a sub-minute pace (e.g. 5500 = 0:55.0)', () => {
    expect(parsePace(5500)).toBe('0:55.0');
  });
});

// ---------------------------------------------------------------------------
// formatElapsed
// ---------------------------------------------------------------------------
describe('formatElapsed', () => {
  it("returns '00:00' for 0 seconds", () => {
    expect(formatElapsed(0)).toBe('00:00');
  });

  it("returns '01:05' for 65 seconds", () => {
    expect(formatElapsed(65)).toBe('01:05');
  });

  it("returns '01:58' for 118 seconds", () => {
    expect(formatElapsed(118)).toBe('01:58');
  });

  it("returns '60:00' for 3600 seconds", () => {
    expect(formatElapsed(3600)).toBe('60:00');
  });

  it("returns '00:59' for 59 seconds", () => {
    expect(formatElapsed(59)).toBe('00:59');
  });

  it('pads minutes and seconds with leading zeros', () => {
    expect(formatElapsed(5)).toBe('00:05');
    expect(formatElapsed(600)).toBe('10:00');
  });
});

// ---------------------------------------------------------------------------
// Workout state helpers
// ---------------------------------------------------------------------------
describe('PM5WorkoutState and state helpers', () => {
  it('names all 14 states and is frozen', () => {
    expect(Object.values(PM5WorkoutState)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    expect(PM5WorkoutState.workoutRow).toBe(1);
    expect(PM5WorkoutState.terminate).toBe(11);
    expect(Object.isFrozen(PM5WorkoutState)).toBe(true);
  });

  const table = [
    [0, 'idle'],
    [1, 'work'],
    [2, 'idle'],
    [3, 'rest'],
    [4, 'work'],
    [5, 'work'],
    [6, 'rest'],
    [7, 'rest'],
    [8, 'rest'],
    [9, 'rest'],
    [10, 'end'],
    [11, 'end'],
    [12, 'end'],
    [13, 'idle'],
  ];

  it.each(table)('state %i classifies as %s', (state, kind) => {
    expect(isWorkingState(state)).toBe(kind === 'work');
    expect(isRestState(state)).toBe(kind === 'rest');
    expect(isEndState(state)).toBe(kind === 'end');
  });
});

// ---------------------------------------------------------------------------
// 0031 general status
// ---------------------------------------------------------------------------
describe('parseGeneralStatus (0031)', () => {
  it('decodes elapsed (0.01 s) and distance (0.1 m, unrounded)', () => {
    const view = makePacket(19);
    set3ByteLE(view, 0, 11800);
    set3ByteLE(view, 3, 25006);
    const result = parseGeneralStatus(view);
    expect(result.elapsedTime).toBe(118);
    expect(result.distance).toBe(2500.6);
  });

  it('decodes a large elapsed time spanning all 3 bytes', () => {
    const view = makePacket(19);
    set3ByteLE(view, 0, 360000);
    expect(parseGeneralStatus(view).elapsedTime).toBe(3600);
  });

  it('reads workout type from byte 6, workout state from byte 8, rowing state from byte 9', () => {
    const view = makePacket(19);
    view.setUint8(6, 7);
    view.setUint8(8, PM5WorkoutState.intervalWorktime);
    view.setUint8(9, 1);
    const result = parseGeneralStatus(view);
    expect(result.workoutType).toBe(7);
    expect(result.workoutState).toBe(4);
    expect(result.rowingState).toBe(1);
  });

  it('regression: byte 6 = 1 with byte 8 = 0 is waitToBegin, not working', () => {
    const view = makePacket(19);
    view.setUint8(6, 1);
    view.setUint8(8, 0);
    const result = parseGeneralStatus(view);
    expect(result.workoutState).toBe(0);
    expect(isWorkingState(result.workoutState)).toBe(false);
  });

  it('regression: byte 6 = 3 with byte 8 = 1 is working and not ended', () => {
    const view = makePacket(19);
    view.setUint8(6, 3);
    view.setUint8(8, 1);
    const result = parseGeneralStatus(view);
    expect(isWorkingState(result.workoutState)).toBe(true);
    expect(isEndState(result.workoutState)).toBe(false);
  });

  it('regression: bytes 9-16 never yield stroke rate, pace, watts or calories', () => {
    const view = makePacket(19);
    for (let i = 9; i <= 16; i += 1) view.setUint8(i, 0x5a);
    const result = parseGeneralStatus(view);
    expect(result).not.toHaveProperty('strokeRate');
    expect(result).not.toHaveProperty('pace500');
    expect(result).not.toHaveProperty('watts');
    expect(result).not.toHaveProperty('calories');
  });

  it('returns null for a packet shorter than 10 bytes', () => {
    expect(parseGeneralStatus(makePacket(9))).toBeNull();
    expect(parseGeneralStatus(makePacket(10))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 0032 additional status 1
// ---------------------------------------------------------------------------
describe('parseAdditionalStatus1 (0032)', () => {
  it('reads stroke rate byte 5, current pace 7-8 and average pace 9-10', () => {
    const view = makePacket(16);
    set3ByteLE(view, 0, 60000);
    view.setUint8(5, 24);
    view.setUint8(6, 150); // heart rate: ignored (#651)
    setUint16LE(view, 7, 11800);
    setUint16LE(view, 9, 12050);
    expect(parseAdditionalStatus1(view)).toEqual({
      elapsedTime: 600,
      strokeRate: 24,
      currentPace: 11800,
      averagePace: 12050,
    });
  });

  it('returns null for a packet shorter than 11 bytes', () => {
    expect(parseAdditionalStatus1(makePacket(10))).toBeNull();
    expect(parseAdditionalStatus1(makePacket(11))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 0033 additional status 2
// ---------------------------------------------------------------------------
describe('parseAdditionalStatus2 (0033)', () => {
  it('reads average power 4-5 and total calories 6-7', () => {
    const view = makePacket(20);
    set3ByteLE(view, 0, 60000);
    view.setUint8(3, 2); // interval count
    setUint16LE(view, 4, 195);
    setUint16LE(view, 6, 88);
    expect(parseAdditionalStatus2(view)).toEqual({
      elapsedTime: 600,
      averagePower: 195,
      totalCalories: 88,
    });
  });

  it('returns null for a packet shorter than 8 bytes', () => {
    expect(parseAdditionalStatus2(makePacket(7))).toBeNull();
    expect(parseAdditionalStatus2(makePacket(8))).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 0035 rowing stroke data
// ---------------------------------------------------------------------------
describe('parseRowingStrokeData (0035)', () => {
  const packet = strokePacket({
    t: 1234, // 12.34 s
    dist: 5037, // 503.7 m
    driveLen: 112, // 1.12 m
    driveTime: 80, // 0.80 s
    recovery: 160, // 1.60 s
    strokeDist: 980, // 9.80 m
    peak: 2000, // 200.0 lbf
    avg: 1100, // 110.0 lbf
    work: 3456, // 345.6 J
    count: 258,
  });

  it('reads elapsed time from 0-2 in 0.01 s', () => {
    expect(parseRowingStrokeData(packet).elapsedTime).toBeCloseTo(12.34);
  });

  it('reads distance from 3-5 in 0.1 m', () => {
    expect(parseRowingStrokeData(packet).distance).toBeCloseTo(503.7);
  });

  it('reads drive length from byte 6 in 0.01 m', () => {
    expect(parseRowingStrokeData(packet).driveLength).toBeCloseTo(1.12);
  });

  it('reads drive time from byte 7 in 0.01 s', () => {
    expect(parseRowingStrokeData(packet).driveTime).toBeCloseTo(0.8);
  });

  it('reads stroke recovery time from 8-9 in 0.01 s', () => {
    expect(parseRowingStrokeData(packet).strokeRecoveryTime).toBeCloseTo(1.6);
  });

  it('reads stroke distance from 10-11 in 0.01 m', () => {
    expect(parseRowingStrokeData(packet).strokeDistance).toBeCloseTo(9.8);
  });

  it('reads peak drive force from 12-13 and reports it in newtons', () => {
    expect(parseRowingStrokeData(packet).peakDriveForce).toBeCloseTo(
      200 * LBF_TO_N
    );
  });

  it('reads average drive force from 14-15 and reports it in newtons', () => {
    expect(parseRowingStrokeData(packet).averageDriveForce).toBeCloseTo(
      110 * LBF_TO_N
    );
  });

  it('reads work per stroke from 16-17 in 0.1 J', () => {
    expect(parseRowingStrokeData(packet).workPerStroke).toBeCloseTo(345.6);
  });

  it('reads stroke count from 18-19', () => {
    expect(parseRowingStrokeData(packet).strokeCount).toBe(258);
  });

  // 258 is 0x0102: a big-endian read would give 513.
  it('reads the uint16 fields little-endian', () => {
    const view = strokePacket({ count: 0x0102 });
    expect(view.getUint8(18)).toBe(0x02);
    expect(view.getUint8(19)).toBe(0x01);
    expect(parseRowingStrokeData(view).strokeCount).toBe(258);
  });

  it('converts pounds-force to newtons at the documented factor', () => {
    expect(LBF_TO_N).toBeCloseTo(4.4482216152605, 12);
  });

  it('returns null for a 19-byte packet rather than throwing', () => {
    expect(() => parseRowingStrokeData(makePacket(19))).not.toThrow();
    expect(parseRowingStrokeData(makePacket(19))).toBeNull();
  });

  it('returns null for an empty packet and for no packet at all', () => {
    expect(parseRowingStrokeData(makePacket(0))).toBeNull();
    expect(parseRowingStrokeData(null)).toBeNull();
  });

  // 0xFF / 0xFFFF is the monitor's "out of range". It has to become null here:
  // 255 / 100 is 2.55, which is a legal drive length and a legal drive time.
  it('nulls a saturated drive length and leaves the other fields alone', () => {
    const parsed = parseRowingStrokeData(
      strokePacket({ driveLen: 0xff, driveTime: 80, recovery: 160 })
    );
    expect(parsed.driveLength).toBeNull();
    expect(parsed.driveTime).toBeCloseTo(0.8);
    expect(parsed.strokeRecoveryTime).toBeCloseTo(1.6);
  });

  it('nulls a saturated drive time and leaves the other fields alone', () => {
    const parsed = parseRowingStrokeData(
      strokePacket({ driveLen: 112, driveTime: 0xff, recovery: 160 })
    );
    expect(parsed.driveTime).toBeNull();
    expect(parsed.driveLength).toBeCloseTo(1.12);
  });

  it('nulls a saturated stroke recovery time', () => {
    const parsed = parseRowingStrokeData(
      strokePacket({ driveLen: 112, driveTime: 80, recovery: 0xffff })
    );
    expect(parsed.strokeRecoveryTime).toBeNull();
    expect(parsed.driveTime).toBeCloseTo(0.8);
  });

  it('reads the highest unsaturated drive length, 2.54 m, as a measurement', () => {
    expect(
      parseRowingStrokeData(strokePacket({ driveLen: 254 })).driveLength
    ).toBeCloseTo(2.54);
  });
});

// ---------------------------------------------------------------------------
// 0036 additional stroke data
// ---------------------------------------------------------------------------
describe('parseAdditionalStrokeData (0036)', () => {
  const data = {
    t: 2500, // 25.00 s
    power: 243,
    cal: 612,
    count: 41,
    projTime: 2400,
    projDist: 7500,
    projOther: 99,
  };

  it('reads elapsed time from 0-2 in 0.01 s', () => {
    expect(parseAdditionalStrokeData(addStrokePacket(data)).elapsedTime).toBe(
      25
    );
  });

  it('reads stroke power from 3-4 in watts', () => {
    expect(parseAdditionalStrokeData(addStrokePacket(data)).strokePower).toBe(
      243
    );
  });

  it('reads stroke calories from 5-6', () => {
    expect(
      parseAdditionalStrokeData(addStrokePacket(data)).strokeCalories
    ).toBe(612);
  });

  it('reads stroke count from 7-8', () => {
    expect(parseAdditionalStrokeData(addStrokePacket(data)).strokeCount).toBe(
      41
    );
  });

  it('reads the three projected-work fields from 9-11, 12-14 and 15-17', () => {
    const parsed = parseAdditionalStrokeData(addStrokePacket(data));
    expect(parsed.projectedWorkTime).toBe(2400);
    expect(parsed.projectedWorkDistance).toBe(7500);
    expect(parsed.projectedWorkOther).toBe(99);
  });

  // Revision 0.34 grew the characteristic from 15 bytes to 18 by appending
  // projected work other, so a rev-0.25 monitor is read, not rejected, and
  // only that trailing field is missing.
  it('gives the same result at 15 bytes, with only the trailing field null', () => {
    expect(parseAdditionalStrokeData(addStrokePacket(data, 15))).toEqual({
      ...parseAdditionalStrokeData(addStrokePacket(data)),
      projectedWorkOther: null,
    });
  });

  it('returns null for a 14-byte packet', () => {
    expect(parseAdditionalStrokeData(makePacket(14))).toBeNull();
    expect(parseAdditionalStrokeData(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isNewerStroke
// ---------------------------------------------------------------------------
describe('isNewerStroke', () => {
  it('accepts the first stroke of a connection', () => {
    expect(isNewerStroke(null, { strokeCount: 1, elapsedTime: 3 })).toBe(true);
  });

  it('accepts a higher stroke count', () => {
    expect(
      isNewerStroke(
        { strokeCount: 9, elapsedTime: 30 },
        { strokeCount: 10, elapsedTime: 33 }
      )
    ).toBe(true);
  });

  it('rejects a duplicate stroke count', () => {
    expect(
      isNewerStroke(
        { strokeCount: 9, elapsedTime: 30 },
        { strokeCount: 9, elapsedTime: 30 }
      )
    ).toBe(false);
  });

  it('rejects an out-of-order packet, a lower count with the clock advancing', () => {
    expect(
      isNewerStroke(
        { strokeCount: 9, elapsedTime: 30 },
        { strokeCount: 8, elapsedTime: 31 }
      )
    ).toBe(false);
  });

  // A reset or a rearm restarts both counters, so the clock going backwards is
  // what lets the next piece's first stroke land.
  it('accepts a lower count when the monitor clock went backwards', () => {
    expect(
      isNewerStroke(
        { strokeCount: 9, elapsedTime: 300 },
        { strokeCount: 1, elapsedTime: 2 }
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatStrokeRatio / formatDriveLength
// ---------------------------------------------------------------------------
describe('formatStrokeRatio', () => {
  it('formats a 0.80 s drive against a 1.60 s recovery as 1 : 2.0', () => {
    expect(formatStrokeRatio(0.8, 1.6)).toBe('1 : 2.0');
  });

  it('keeps one decimal on an uneven ratio', () => {
    expect(formatStrokeRatio(0.75, 1.8)).toBe('1 : 2.4');
  });

  it('reports a long recovery without capping it', () => {
    expect(formatStrokeRatio(0.4, 5.0)).toBe('1 : 12.5');
  });

  // Never Infinity, never NaN.
  it("returns '--' for a zero drive or recovery time", () => {
    expect(formatStrokeRatio(0, 1.6)).toBe('--');
    expect(formatStrokeRatio(0.8, 0)).toBe('--');
  });

  it("returns '--' for a saturated, missing or negative part", () => {
    expect(formatStrokeRatio(null, 1.6)).toBe('--');
    expect(formatStrokeRatio(0.8, null)).toBe('--');
    expect(formatStrokeRatio(undefined, undefined)).toBe('--');
    expect(formatStrokeRatio(NaN, 1.6)).toBe('--');
    expect(formatStrokeRatio(-0.8, 1.6)).toBe('--');
  });
});

describe('formatDriveLength', () => {
  it('formats 1.12 m to two decimals', () => {
    expect(formatDriveLength(1.12)).toBe('1.12');
  });

  it('pads a value that needs the second decimal', () => {
    expect(formatDriveLength(1.3)).toBe('1.30');
  });

  // The PM5 reports 0 for a field it never measured, as the saved row's `||`
  // already assumes.
  it("returns '--' for 0, null, undefined and NaN", () => {
    expect(formatDriveLength(0)).toBe('--');
    expect(formatDriveLength(null)).toBe('--');
    expect(formatDriveLength(undefined)).toBe('--');
    expect(formatDriveLength(NaN)).toBe('--');
  });

  it('turns a saturated drive length into -- while the ratio is unaffected', () => {
    const parsed = parseRowingStrokeData(
      strokePacket({ driveLen: 0xff, driveTime: 80, recovery: 160 })
    );
    expect(formatDriveLength(parsed.driveLength)).toBe('--');
    expect(formatStrokeRatio(parsed.driveTime, parsed.strokeRecoveryTime)).toBe(
      '1 : 2.0'
    );
  });

  it('a saturated drive time blanks the ratio as well as the drive time', () => {
    const parsed = parseRowingStrokeData(
      strokePacket({ driveLen: 112, driveTime: 0xff, recovery: 160 })
    );
    expect(formatStrokeRatio(parsed.driveTime, parsed.strokeRecoveryTime)).toBe(
      '--'
    );
    expect(formatDriveLength(parsed.driveLength)).toBe('1.12');
  });

  it('a saturated recovery time blanks the ratio', () => {
    const parsed = parseRowingStrokeData(
      strokePacket({ driveLen: 112, driveTime: 80, recovery: 0xffff })
    );
    expect(formatStrokeRatio(parsed.driveTime, parsed.strokeRecoveryTime)).toBe(
      '--'
    );
  });
});

// ---------------------------------------------------------------------------
// 0039 rowing summary
// ---------------------------------------------------------------------------
describe('parseRowingSummary (0039)', () => {
  it('reads elapsed 4-6, distance 7-9, avg spm 10 and workout type 17', () => {
    const view = makePacket(20);
    setUint16LE(view, 0, 0xffff); // log date
    setUint16LE(view, 2, 0xffff); // log time
    set3ByteLE(view, 4, 120000);
    set3ByteLE(view, 7, 50004);
    view.setUint8(10, 24);
    view.setUint8(17, 1);
    setUint16LE(view, 18, 1200); // avg pace in 0.1 s units: not read
    expect(parseRowingSummary(view)).toEqual({
      elapsedTime: 1200,
      distance: 5000.4,
      avgSpm: 24,
      workoutType: 1,
    });
  });

  it('returns workoutType null for a packet under 18 bytes', () => {
    const view = makePacket(11);
    view.setUint8(10, 22);
    const result = parseRowingSummary(view);
    expect(result.avgSpm).toBe(22);
    expect(result.workoutType).toBeNull();
  });

  it('returns null for a packet shorter than 11 bytes', () => {
    expect(parseRowingSummary(makePacket(10))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mergeStatus
// ---------------------------------------------------------------------------
describe('mergeStatus', () => {
  const general = {
    elapsedTime: 600,
    distance: 2500.6,
    workoutType: 0,
    workoutState: 1,
    rowingState: 1,
  };

  it('merges fresh 0032/0033 into one sample (pace 12000 -> 203 W)', () => {
    const sample = mergeStatus(
      general,
      {
        elapsedTime: 599.5,
        strokeRate: 24,
        currentPace: 12000,
        averagePace: 0,
      },
      { elapsedTime: 600.5, averagePower: 0, totalCalories: 90 }
    );
    expect(sample).toEqual({
      elapsedTime: 600,
      elapsedStr: '10:00',
      distance: 2500.6,
      workoutState: 1,
      rowingState: 1,
      strokeRate: 24,
      pace500: 12000,
      paceStr: '2:00.0',
      watts: 203,
      calories: 90,
    });
  });

  it('nulls fields from 0032/0033 more than STALE_LIMIT_S old', () => {
    const late = 600 - STALE_LIMIT_S - 0.5;
    const sample = mergeStatus(
      general,
      { elapsedTime: late, strokeRate: 24, currentPace: 12000, averagePace: 0 },
      { elapsedTime: late, averagePower: 190, totalCalories: 90 }
    );
    expect(sample.strokeRate).toBeNull();
    expect(sample.pace500).toBeNull();
    expect(sample.paceStr).toBe('--:--');
    expect(sample.watts).toBeNull();
    expect(sample.calories).toBeNull();
  });

  // #739: at the PM5's default 500 ms rate, each 0032 arriving just after its
  // 0031 and one 0032 lost on the link must not blank the pace on any sample.
  // The 0032 stamp sits a clock tick (0.01 s) before its 0031's, as two
  // packets built a moment apart do; at the old 1.0 s window that tick alone
  // decided whether the sample after a lost 0032 had a pace.
  it('keeps pace on every sample when 0032 trails 0031 and one is lost', () => {
    const period = 0.5;
    let add1 = null;
    const paces = [];
    for (let i = 0; i < 8; i++) {
      const t = 600 + i * period;
      paces.push(
        mergeStatus({ ...general, elapsedTime: t }, add1, null).paceStr
      );
      if (i !== 3) {
        add1 = {
          elapsedTime: t - 0.01,
          strokeRate: 18,
          currentPace: 16080,
          averagePace: 0,
        };
      }
    }
    expect(paces.slice(1)).not.toContain('--:--');
  });

  it('nulls fields when 0032/0033 have never arrived', () => {
    const sample = mergeStatus(general, null, null);
    expect(sample.strokeRate).toBeNull();
    expect(sample.pace500).toBeNull();
    expect(sample.watts).toBeNull();
    expect(sample.calories).toBeNull();
    expect(sample.distance).toBe(2500.6);
  });

  it('keeps a raw zero pace as 0 but gives it no watts', () => {
    const sample = mergeStatus(
      general,
      { elapsedTime: 600, strokeRate: 0, currentPace: 0, averagePace: 0 },
      { elapsedTime: 600, averagePower: 0, totalCalories: 0 }
    );
    expect(sample.pace500).toBe(0);
    expect(sample.strokeRate).toBe(0);
    expect(sample.calories).toBe(0);
    expect(sample.watts).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildPM5Summary
// ---------------------------------------------------------------------------
describe('buildPM5Summary', () => {
  const samples = [
    {
      elapsedTime: 240,
      pace500: 12000,
      watts: 203,
      strokeRate: 22,
      distance: 1000,
    },
    {
      elapsedTime: 480,
      pace500: 11800,
      watts: 214,
      strokeRate: 24,
      distance: 2000,
    },
    {
      elapsedTime: 500,
      pace500: 0,
      watts: null,
      strokeRate: null,
      distance: 2100,
    },
    {
      elapsedTime: 525,
      pace500: null,
      watts: null,
      strokeRate: null,
      distance: 2200,
    },
  ];
  const lastSample = { distance: 2500.6, elapsedTime: 600 };

  it('prefers the PM5 figures (0039, 0032 average pace, 0033 power and calories)', () => {
    expect(
      buildPM5Summary({
        samples,
        lastSample,
        add1: { elapsedTime: 599.5, averagePace: 12050 },
        add2: { elapsedTime: 600, averagePower: 190, totalCalories: 250 },
        rowSummary: { elapsedTime: 1200, distance: 5000.4, avgSpm: 25 },
        maxWatts: 214,
      })
    ).toEqual({
      distance: 5000,
      elapsedTime: 1200,
      elapsedStr: '20:00',
      avgWatts: 190,
      avgPace: 12050,
      avgSpm: 25,
      maxWatts: 214,
      calories: 250,
    });
  });

  it('falls back to the last sample for distance and time without 0039', () => {
    const s = buildPM5Summary({ samples, lastSample });
    expect(s.distance).toBe(2501);
    expect(s.elapsedTime).toBe(600);
    expect(s.elapsedStr).toBe('10:00');
  });

  it('a zeroed idle packet after the work does not replace the worked distance and time', () => {
    const s = buildPM5Summary({
      samples,
      lastSample: { distance: 0, elapsedTime: 0 },
    });
    expect(s.distance).toBe(2200);
    expect(s.elapsedTime).toBe(525);
  });

  it('falls back to the mean of non-zero sample paces without 0032 average pace', () => {
    expect(
      buildPM5Summary({
        samples,
        lastSample,
        add1: { elapsedTime: 600, averagePace: 0 },
      }).avgPace
    ).toBe(11900);
  });

  it('derives avgWatts from avgPace when 0033 average power is missing or 0', () => {
    const add1 = { elapsedTime: 600, averagePace: 12000 };
    expect(buildPM5Summary({ samples: [], lastSample, add1 }).avgWatts).toBe(
      203
    );
    expect(
      buildPM5Summary({
        samples: [],
        lastSample,
        add1,
        add2: { elapsedTime: 600, averagePower: 0, totalCalories: 10 },
      }).avgWatts
    ).toBe(203);
  });

  it('uses a fresh 0033 but ignores one older than SUMMARY_STALE_LIMIT_S', () => {
    const add1 = { elapsedTime: 600, averagePace: 12000 };
    const fresh = { elapsedTime: 595, averagePower: 190, totalCalories: 250 };
    const stale = {
      elapsedTime: 600 - SUMMARY_STALE_LIMIT_S - 1,
      averagePower: 150,
      totalCalories: 200,
    };
    const withFresh = buildPM5Summary({
      samples,
      lastSample,
      add1,
      add2: fresh,
    });
    expect(withFresh.avgWatts).toBe(190);
    expect(withFresh.calories).toBe(250);

    const withStale = buildPM5Summary({
      samples,
      lastSample,
      add1,
      add2: stale,
    });
    expect(withStale.avgWatts).toBe(203);
    expect(withStale.calories).toBe(0);
  });

  it('ignores a 0032 average pace older than SUMMARY_STALE_LIMIT_S', () => {
    expect(
      buildPM5Summary({
        samples,
        lastSample,
        add1: { elapsedTime: 300, averagePace: 15000 },
      }).avgPace
    ).toBe(11900);
  });

  it('falls back to mean sample watts when there is no pace at all', () => {
    expect(
      buildPM5Summary({
        samples: [{ watts: 200 }, { watts: null }, { watts: 180 }],
      }).avgWatts
    ).toBe(190);
  });

  it('falls back to mean sample stroke rate when 0039 avg spm is missing or 0', () => {
    expect(buildPM5Summary({ samples }).avgSpm).toBe(23);
    expect(
      buildPM5Summary({
        samples,
        rowSummary: { elapsedTime: 1, distance: 1, avgSpm: 0 },
      }).avgSpm
    ).toBe(23);
  });

  it('summaryReference picks the later of the last pushed sample and the last packet', () => {
    const pushed = { elapsedTime: 525 };
    expect(summaryReference([pushed], { elapsedTime: 0 })).toBe(pushed);
    const later = { elapsedTime: 600 };
    expect(summaryReference([pushed], later)).toBe(later);
    expect(summaryReference([], later)).toBe(later);
    expect(summaryReference([pushed], null)).toBe(pushed);
    expect(summaryReference([], null)).toBeNull();
  });

  it('returns a zero summary with nothing seen', () => {
    expect(buildPM5Summary({ samples: [] })).toEqual({
      distance: 0,
      elapsedTime: 0,
      elapsedStr: '00:00',
      avgWatts: 0,
      avgPace: 0,
      avgSpm: 0,
      maxWatts: 0,
      calories: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------
describe('subscribe', () => {
  beforeEach(() => {
    captureError.mockReset();
  });

  function fakeChar() {
    let listeners = [];
    const calls = [];
    const char = {
      uuid: 'ce060031-43e5-11e4-916c-0800200c9a66',
      calls,
      startNotifications: vi.fn(async () => {
        calls.push('startNotifications');
      }),
      addEventListener: (_type, fn) => {
        calls.push('addEventListener');
        listeners.push(fn);
      },
      removeEventListener: (_type, fn) => {
        listeners = listeners.filter((l) => l !== fn);
      },
      listenerCount: () => listeners.length,
      fire: (dv) => listeners.forEach((fn) => fn({ target: { value: dv } })),
    };
    return char;
  }

  it('attaches the listener before starting notifications', async () => {
    const char = fakeChar();
    await subscribe(char, parseGeneralStatus, vi.fn());
    expect(char.calls).toEqual(['addEventListener', 'startNotifications']);
  });

  it('keeps a packet that arrives while notifications are starting', async () => {
    const char = fakeChar();
    const cb = vi.fn();
    char.startNotifications.mockImplementation(async () => {
      const view = makePacket(19);
      view.setUint8(8, 1);
      char.fire(view);
    });
    await subscribe(char, parseGeneralStatus, cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('starts notifications and passes parsed packets to the callback', async () => {
    const char = fakeChar();
    const cb = vi.fn();
    await subscribe(char, parseGeneralStatus, cb);
    expect(char.startNotifications).toHaveBeenCalled();
    const view = makePacket(19);
    view.setUint8(8, 1);
    char.fire(view);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ workoutState: 1 })
    );
  });

  it('drops short packets and reports only once per subscription', async () => {
    const char = fakeChar();
    const cb = vi.fn();
    await subscribe(char, parseGeneralStatus, cb);
    char.fire(makePacket(4));
    char.fire(makePacket(4));
    expect(cb).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0][1]).toEqual(
      expect.objectContaining({ source: 'pm5Bluetooth', byteLength: 4 })
    );
  });

  it('rejects when notifications cannot start', async () => {
    const char = fakeChar();
    char.startNotifications.mockRejectedValue(new Error('GATT error'));
    await expect(subscribe(char, parseGeneralStatus, vi.fn())).rejects.toThrow(
      'GATT error'
    );
    expect(char.listenerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// connectToPM5
// ---------------------------------------------------------------------------
describe('connectToPM5', () => {
  const UUID = (n) => `ce0600${n}-43e5-11e4-916c-0800200c9a66`;
  let original;

  function installBluetooth(missing = []) {
    const service = {
      getCharacteristic: vi.fn((uuid) =>
        missing.some((n) => UUID(n) === uuid)
          ? Promise.reject(new Error(`NotFoundError ${uuid}`))
          : Promise.resolve({ uuid })
      ),
    };
    const device = {
      gatt: {
        connected: true,
        disconnect: vi.fn(),
        connect: vi.fn().mockResolvedValue({
          getPrimaryService: vi.fn().mockResolvedValue(service),
        }),
      },
    };
    Object.defineProperty(navigator, 'bluetooth', {
      value: { requestDevice: vi.fn().mockResolvedValue(device) },
      configurable: true,
    });
    return device;
  }

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(navigator, 'bluetooth');
  });

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'bluetooth', original);
    else delete navigator.bluetooth;
  });

  // The PM5 advertises ce060000, not the rowing service: a scan filtered on
  // ce060030 finds nothing.
  it('scans for the advertised device UUID or the PM5 name, not the rowing service', async () => {
    installBluetooth();
    await connectToPM5();
    const options = navigator.bluetooth.requestDevice.mock.calls[0][0];
    expect(options.filters).toEqual([
      { services: ['ce060000-43e5-11e4-916c-0800200c9a66'] },
      { namePrefix: 'PM5' },
    ]);
    expect(options.optionalServices).toEqual([
      'ce060030-43e5-11e4-916c-0800200c9a66',
    ]);
  });

  it('returns all six characteristics when present', async () => {
    const device = installBluetooth();
    const result = await connectToPM5();
    expect(result.device).toBe(device);
    expect(result.chars).toEqual({
      generalStatus: { uuid: UUID('31') },
      additionalStatus1: { uuid: UUID('32') },
      additionalStatus2: { uuid: UUID('33') },
      workoutSummary: { uuid: UUID('39') },
      strokeData: { uuid: UUID('35') },
      additionalStrokeData: { uuid: UUID('36') },
    });
    expect(result.errors).toEqual({
      additionalStatus1: null,
      additionalStatus2: null,
      workoutSummary: null,
      strokeData: null,
      additionalStrokeData: null,
    });
  });

  it('nulls an optional characteristic that is missing and keeps its rejection', async () => {
    installBluetooth(['32', '39']);
    const { chars, errors } = await connectToPM5();
    expect(chars.generalStatus).toEqual({ uuid: UUID('31') });
    expect(chars.additionalStatus1).toBeNull();
    expect(chars.additionalStatus2).toEqual({ uuid: UUID('33') });
    expect(chars.workoutSummary).toBeNull();
    expect(chars.strokeData).toEqual({ uuid: UUID('35') });
    expect(chars.additionalStrokeData).toEqual({ uuid: UUID('36') });
    expect(errors.additionalStatus1).toBeInstanceOf(Error);
    expect(errors.additionalStatus1.message).toBe(
      `NotFoundError ${UUID('32')}`
    );
    expect(errors.additionalStatus2).toBeNull();
    expect(errors.workoutSummary.message).toBe(`NotFoundError ${UUID('39')}`);
    expect(errors.strokeData).toBeNull();
    expect(errors.additionalStrokeData).toBeNull();
  });

  it('nulls a missing 0035 and keeps its rejection, with 0036 unaffected', async () => {
    installBluetooth(['35']);
    const { chars, errors } = await connectToPM5();
    expect(chars.strokeData).toBeNull();
    expect(errors.strokeData).toBeInstanceOf(Error);
    expect(errors.strokeData.message).toBe(`NotFoundError ${UUID('35')}`);
    expect(chars.additionalStrokeData).toEqual({ uuid: UUID('36') });
    expect(errors.additionalStrokeData).toBeNull();
  });

  it('nulls a missing 0036 and keeps its rejection, with 0035 unaffected', async () => {
    installBluetooth(['36']);
    const { chars, errors } = await connectToPM5();
    expect(chars.additionalStrokeData).toBeNull();
    expect(errors.additionalStrokeData.message).toBe(
      `NotFoundError ${UUID('36')}`
    );
    expect(chars.strokeData).toEqual({ uuid: UUID('35') });
  });

  it('rejects when the 0031 general status characteristic is missing', async () => {
    const device = installBluetooth(['31']);
    await expect(connectToPM5()).rejects.toThrow(`NotFoundError ${UUID('31')}`);
    // The link was up, so it is closed before the error propagates.
    expect(device.gatt.disconnect).toHaveBeenCalledTimes(1);
  });

  it('leaves the link alone when the optional characteristics are missing', async () => {
    const device = installBluetooth(['32', '33', '39']);
    await connectToPM5();
    expect(device.gatt.disconnect).not.toHaveBeenCalled();
  });

  it('rejects when Web Bluetooth is unavailable', async () => {
    Object.defineProperty(navigator, 'bluetooth', {
      value: undefined,
      configurable: true,
    });
    await expect(connectToPM5()).rejects.toThrow(/Web Bluetooth/);
  });
});

// AC-T2: the screen translates by code; the English message stays for logs.
describe('connectToPM5 without Web Bluetooth', () => {
  it('throws a coded error with the English message kept', async () => {
    const had = 'bluetooth' in navigator;
    const saved = navigator.bluetooth;
    Object.defineProperty(navigator, 'bluetooth', {
      value: undefined,
      configurable: true,
    });
    try {
      await expect(connectToPM5()).rejects.toMatchObject({
        code: PM5_UNSUPPORTED,
        message:
          'Web Bluetooth is not supported in this browser. Use Chrome or Edge.',
      });
    } finally {
      if (had) {
        Object.defineProperty(navigator, 'bluetooth', {
          value: saved,
          configurable: true,
        });
      } else {
        delete navigator.bluetooth;
      }
    }
  });
});
