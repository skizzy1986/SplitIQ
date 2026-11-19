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

  it('returns all four characteristics when present', async () => {
    const device = installBluetooth();
    const result = await connectToPM5();
    expect(result.device).toBe(device);
    expect(result.chars).toEqual({
      generalStatus: { uuid: UUID('31') },
      additionalStatus1: { uuid: UUID('32') },
      additionalStatus2: { uuid: UUID('33') },
      workoutSummary: { uuid: UUID('39') },
    });
    expect(result.errors).toEqual({
      additionalStatus1: null,
      additionalStatus2: null,
      workoutSummary: null,
    });
  });

  it('nulls an optional characteristic that is missing and keeps its rejection', async () => {
    installBluetooth(['32', '39']);
    const { chars, errors } = await connectToPM5();
    expect(chars.generalStatus).toEqual({ uuid: UUID('31') });
    expect(chars.additionalStatus1).toBeNull();
    expect(chars.additionalStatus2).toEqual({ uuid: UUID('33') });
    expect(chars.workoutSummary).toBeNull();
    expect(errors.additionalStatus1).toBeInstanceOf(Error);
    expect(errors.additionalStatus1.message).toBe(
      `NotFoundError ${UUID('32')}`
    );
    expect(errors.additionalStatus2).toBeNull();
    expect(errors.workoutSummary.message).toBe(`NotFoundError ${UUID('39')}`);
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
