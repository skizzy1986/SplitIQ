import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock connect + subscribe so the real hook logic and the real parsers run
// against synthetic packets instead of hardware.
let subscriptions = {};
let failSubscribe = new Set();
// Per-characteristic promises that hold a subscribe() open until resolved.
let subscribeGates = {};
const connectToPM5Mock = vi.fn();
const disconnectPM5Mock = vi.fn();

vi.mock('../../services/pm5Bluetooth', async () => {
  const actual = await vi.importActual('../../services/pm5Bluetooth');
  return {
    ...actual,
    connectToPM5: (...args) => connectToPM5Mock(...args),
    subscribe: async (char, parser, callback) => {
      if (failSubscribe.has(char.id)) {
        throw new Error(`startNotifications failed for ${char.id}`);
      }
      subscriptions[char.id] = { parser, callback };
      if (subscribeGates[char.id]) await subscribeGates[char.id];
    },
    disconnectPM5: (...args) => disconnectPM5Mock(...args),
  };
});

vi.mock('../../utils/sentry.js', () => ({ captureError: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn() },
}));

import { usePM5 } from '../usePM5';
import { captureError } from '../../utils/sentry.js';

const fakeDevice = { addEventListener: vi.fn(), gatt: { connected: true } };

const ALL_CHARS = {
  generalStatus: { id: '0031' },
  additionalStatus1: { id: '0032' },
  additionalStatus2: { id: '0033' },
  workoutSummary: { id: '0039' },
  strokeData: { id: '0035' },
  additionalStrokeData: { id: '0036' },
};

// ---------------------------------------------------------------------------
// Synthetic packets at the PM5 offsets
// ---------------------------------------------------------------------------
function set3ByteLE(view, n, value) {
  view.setUint8(n, value & 0xff);
  view.setUint8(n + 1, (value >> 8) & 0xff);
  view.setUint8(n + 2, (value >> 16) & 0xff);
}

function general({ t = 0, dist = 0, state = 1, rowing = 1 } = {}) {
  const v = new DataView(new ArrayBuffer(19));
  set3ByteLE(v, 0, Math.round(t * 100));
  set3ByteLE(v, 3, Math.round(dist * 10));
  v.setUint8(8, state);
  v.setUint8(9, rowing);
  return v;
}

function add1({ t = 0, spm = 24, pace = 12000, avgPace = 0 } = {}) {
  const v = new DataView(new ArrayBuffer(17));
  set3ByteLE(v, 0, Math.round(t * 100));
  v.setUint8(5, spm);
  v.setUint16(7, pace, true);
  v.setUint16(9, avgPace, true);
  return v;
}

function add2({ t = 0, power = 0, calories = 0 } = {}) {
  const v = new DataView(new ArrayBuffer(20));
  set3ByteLE(v, 0, Math.round(t * 100));
  v.setUint16(4, power, true);
  v.setUint16(6, calories, true);
  return v;
}

function rowSummary({ t = 0, dist = 0, spm = 0 } = {}) {
  const v = new DataView(new ArrayBuffer(20));
  set3ByteLE(v, 4, Math.round(t * 100));
  set3ByteLE(v, 7, Math.round(dist * 10));
  v.setUint8(10, spm);
  return v;
}

// 0035 rowing stroke data, in the units a caller thinks in.
function stroke({
  t = 0,
  driveLen = 1.12,
  driveTime = 0.8,
  recovery = 1.6,
  count = 1,
} = {}) {
  const v = new DataView(new ArrayBuffer(20));
  set3ByteLE(v, 0, Math.round(t * 100));
  v.setUint8(6, Math.round(driveLen * 100));
  v.setUint8(7, Math.round(driveTime * 100));
  v.setUint16(8, Math.round(recovery * 100), true);
  v.setUint16(18, count, true);
  return v;
}

// 0036 additional stroke data, 18 bytes.
function addStroke({ t = 0, power = 240, count = 1 } = {}) {
  const v = new DataView(new ArrayBuffer(18));
  set3ByteLE(v, 0, Math.round(t * 100));
  v.setUint16(3, power, true);
  v.setUint16(7, count, true);
  return v;
}

// Run the real parser the hook registered, then its callback.
function emit(id, dv) {
  act(() => {
    const { parser, callback } = subscriptions[id];
    const parsed = parser(dv);
    if (parsed !== null) callback(parsed);
  });
}

// One working stroke sample with fresh 0032/0033 alongside.
function rowStroke({ t, dist, pace = 12000, spm = 24, avgPace, power, cal }) {
  emit('0032', add1({ t, spm, pace, avgPace }));
  emit('0033', add2({ t, power, calories: cal }));
  emit('0031', general({ t, dist, state: 1, rowing: 1 }));
}

async function connectedHook(chars = ALL_CHARS, errors = undefined) {
  const rendered = renderHook(() => usePM5());
  connectToPM5Mock.mockResolvedValue({ device: fakeDevice, chars, errors });
  await act(async () => {
    await rendered.result.current.connect();
  });
  return rendered;
}

beforeEach(() => {
  subscriptions = {};
  failSubscribe = new Set();
  subscribeGates = {};
  connectToPM5Mock.mockReset();
  disconnectPM5Mock.mockReset();
  captureError.mockReset();
  fakeDevice.addEventListener.mockReset();
});

// The gattserverdisconnected handler the hook registered on the device, so a
// test can fire the drop the erg actually does (battery, out of range).
function fireGattDisconnected() {
  const [event, handler] = fakeDevice.addEventListener.mock.calls.at(-1);
  expect(event).toBe('gattserverdisconnected');
  act(() => handler());
}

describe('usePM5 live samples', () => {
  it('pushes a merged sample and reports rowing while working with the flywheel moving', async () => {
    const { result } = await connectedHook();
    expect(result.current.status).toBe('connected');

    rowStroke({ t: 10, dist: 50.3, cal: 5 });

    expect(result.current.status).toBe('rowing');
    expect(result.current.metrics).toEqual(
      expect.objectContaining({
        elapsedTime: 10,
        distance: 50.3,
        strokeRate: 24,
        pace500: 12000,
        paceStr: '2:00.0',
        watts: 203,
        calories: 5,
      })
    );

    act(() => result.current.finish());
    expect(result.current.summary).toEqual({
      distance: 50,
      elapsedTime: 10,
      elapsedStr: '00:10',
      avgWatts: 203,
      avgPace: 12000,
      avgSpm: 24,
      maxWatts: 203,
      calories: 5,
    });
  });

  it('a Just Row stop (working, rowing state 0) pushes nothing and reads connected', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 10, dist: 50 });

    emit('0032', add1({ t: 12, pace: 10000 }));
    emit('0031', general({ t: 12, dist: 60, state: 1, rowing: 0 }));

    expect(result.current.status).toBe('connected');
    expect(result.current.metrics.distance).toBe(60);
    expect(result.current.metrics.watts).toBe(350);

    act(() => result.current.finish());
    // The 350 W reading during the stop was never pushed.
    expect(result.current.summary.maxWatts).toBe(203);
  });

  it.each([3, 8])('rest state %i pushes nothing', async (state) => {
    const { result } = await connectedHook();
    rowStroke({ t: 10, dist: 50 });

    emit('0032', add1({ t: 12, pace: 10000 }));
    emit('0031', general({ t: 12, dist: 60, state, rowing: 1 }));
    expect(result.current.status).toBe('connected');

    act(() => result.current.finish());
    expect(result.current.summary.maxWatts).toBe(203);
  });
});

describe('usePM5 end of piece', () => {
  it('an end state after work builds the summary from 0033 power/calories and 0032 average pace', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 599.5, dist: 2498, avgPace: 12100, power: 195, cal: 30 });
    emit('0031', general({ t: 600, dist: 2500.6, state: 10, rowing: 0 }));

    expect(result.current.status).toBe('finished');
    expect(result.current.summary).toEqual({
      distance: 2501,
      elapsedTime: 600,
      elapsedStr: '10:00',
      avgWatts: 195,
      avgPace: 12100,
      avgSpm: 24,
      maxWatts: 203,
      calories: 30,
    });
  });

  it('terminate (state 11) counts as an end', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 10, dist: 50 });
    emit('0031', general({ t: 11, dist: 52, state: 11, rowing: 0 }));
    expect(result.current.status).toBe('finished');
  });

  it('an end state as the first packet, with no work seen, builds nothing', async () => {
    const { result } = await connectedHook();
    emit('0031', general({ t: 600, dist: 2500, state: 12, rowing: 0 }));
    expect(result.current.summary).toBeNull();
    expect(result.current.status).toBe('connected');
  });

  it('state 10 then 0039 builds once and refines only the fields 0039 carries', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 599.5, dist: 2498, avgPace: 12100, power: 195, cal: 30 });
    emit('0031', general({ t: 600, dist: 2500.6, state: 10, rowing: 0 }));
    const built = result.current.summary;

    emit('0039', rowSummary({ t: 601.2, dist: 2502, spm: 25 }));

    expect(result.current.status).toBe('finished');
    expect(result.current.summary).toEqual({
      ...built,
      distance: 2502,
      elapsedTime: 601.2,
      elapsedStr: '10:01',
      avgSpm: 25,
    });
    expect(result.current.summary.avgWatts).toBe(195);
    expect(result.current.summary.maxWatts).toBe(203);
    expect(result.current.summary.calories).toBe(30);
  });

  it('0039 alone after work ends the piece', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 300, dist: 1250 });
    emit('0039', rowSummary({ t: 600, dist: 2500, spm: 26 }));

    expect(result.current.status).toBe('finished');
    expect(result.current.summary.distance).toBe(2500);
    expect(result.current.summary.elapsedTime).toBe(600);
    expect(result.current.summary.avgSpm).toBe(26);
  });

  it('ignores a 0039 that arrives before any work', async () => {
    const { result } = await connectedHook();
    emit('0039', rowSummary({ t: 1800, dist: 7000, spm: 20 }));
    expect(result.current.summary).toBeNull();

    rowStroke({ t: 10, dist: 50 });
    emit('0031', general({ t: 11, dist: 52, state: 10, rowing: 0 }));
    expect(result.current.summary.distance).toBe(52);
  });

  it('repeated end packets do not build a second summary', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 10, dist: 50 });
    emit('0031', general({ t: 11, dist: 52, state: 10, rowing: 0 }));
    const first = result.current.summary;

    emit('0031', general({ t: 12, dist: 53, state: 10, rowing: 0 }));
    emit('0031', general({ t: 13, dist: 54, state: 12, rowing: 0 }));

    expect(result.current.summary).toBe(first);
    expect(result.current.status).toBe('finished');
  });

  it('an end packet after a manual finish() is a no-op', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 10, dist: 50 });
    act(() => result.current.finish());
    const first = result.current.summary;

    emit('0031', general({ t: 11, dist: 52, state: 10, rowing: 0 }));
    expect(result.current.summary).toBe(first);
    expect(result.current.summary.distance).toBe(50);
  });

  it('a zeroed idle packet after the work does not wipe the distance and time at END', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 600, dist: 2500 });
    // The PM5 drops back to waitToBegin with its counters zeroed.
    emit('0031', general({ t: 0, dist: 0, state: 0, rowing: 0 }));
    expect(result.current.status).toBe('connected');

    act(() => result.current.finish());
    expect(result.current.summary.distance).toBe(2500);
    expect(result.current.summary.elapsedTime).toBe(600);
    expect(result.current.summary.elapsedStr).toBe('10:00');
  });

  it('a 0039 from the next piece does not overwrite a built summary', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 599.5, dist: 2498 });
    emit('0031', general({ t: 600, dist: 2500, state: 10, rowing: 0 }));
    const built = result.current.summary;

    // Next piece: rearm, row a short one, its 0039 lands.
    emit('0031', general({ t: 0, dist: 0, state: 13, rowing: 0 }));
    emit('0039', rowSummary({ t: 60, dist: 250, spm: 30 }));

    expect(result.current.summary).toBe(built);
    expect(result.current.summary.distance).toBe(2500);
  });

  it('a 0039 ending within REFINE_MARGIN_S before the piece still refines', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 599.5, dist: 2498 });
    emit('0031', general({ t: 600, dist: 2500, state: 10, rowing: 0 }));

    emit('0039', rowSummary({ t: 598.5, dist: 2499.4, spm: 25 }));
    expect(result.current.summary.distance).toBe(2499);
    expect(result.current.summary.elapsedTime).toBe(598.5);
  });
});

describe('usePM5 connect ordering', () => {
  it('a rowing packet that lands while optional subscriptions are pending is not overwritten', async () => {
    let release;
    subscribeGates = {
      '0032': new Promise((resolve) => {
        release = resolve;
      }),
    };
    const { result } = renderHook(() => usePM5());
    connectToPM5Mock.mockResolvedValue({
      device: fakeDevice,
      chars: ALL_CHARS,
    });

    let pending;
    await act(async () => {
      pending = result.current.connect();
      await vi.waitFor(() => expect(subscriptions['0032']).toBeDefined());
    });
    expect(result.current.status).toBe('connecting');

    emit('0031', general({ t: 1, dist: 3, state: 1, rowing: 1 }));
    expect(result.current.status).toBe('rowing');

    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.status).toBe('rowing');
  });
});

describe('usePM5 missing characteristics', () => {
  it('without 0032/0033 samples carry nulls, connect still succeeds and the gap is reported', async () => {
    const { result } = await connectedHook({
      ...ALL_CHARS,
      additionalStatus1: null,
      additionalStatus2: null,
    });
    expect(result.current.status).toBe('connected');
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Bluetooth',
      char: '0032',
    });
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Bluetooth',
      char: '0033',
    });

    emit('0031', general({ t: 10, dist: 50, state: 1, rowing: 1 }));
    expect(result.current.status).toBe('rowing');
    expect(result.current.metrics.strokeRate).toBeNull();
    expect(result.current.metrics.pace500).toBeNull();
    expect(result.current.metrics.watts).toBeNull();
    expect(result.current.metrics.calories).toBeNull();

    act(() => result.current.finish());
    expect(result.current.summary).toEqual({
      distance: 50,
      elapsedTime: 10,
      elapsedStr: '00:10',
      avgWatts: 0,
      avgPace: 0,
      avgSpm: 0,
      maxWatts: 0,
      calories: 0,
    });
  });

  it('without 0033 avgWatts falls back to the 0032 average pace', async () => {
    const { result } = await connectedHook({
      ...ALL_CHARS,
      additionalStatus2: null,
    });
    emit('0032', add1({ t: 10, avgPace: 12000 }));
    emit('0031', general({ t: 10, dist: 50, state: 1, rowing: 1 }));
    emit('0031', general({ t: 11, dist: 52, state: 10, rowing: 0 }));

    expect(result.current.summary.avgWatts).toBe(203);
    expect(result.current.summary.calories).toBe(0);
  });

  it('reports the original fetch rejection for a missing optional characteristic', async () => {
    const original = new Error('NotFoundError: 0033');
    await connectedHook(
      { ...ALL_CHARS, additionalStatus2: null },
      {
        additionalStatus1: null,
        additionalStatus2: original,
        workoutSummary: null,
      }
    );
    expect(captureError).toHaveBeenCalledWith(original, {
      source: 'pm5Bluetooth',
      char: '0033',
    });
  });

  it('a failed optional subscription is reported and connect carries on', async () => {
    failSubscribe = new Set(['0039']);
    const { result } = await connectedHook();
    expect(result.current.status).toBe('connected');
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Bluetooth',
      char: '0039',
    });
  });

  it('a missing 0031 characteristic is an error', async () => {
    const { result } = renderHook(() => usePM5());
    connectToPM5Mock.mockRejectedValue(new Error('NotFoundError: 0031'));
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('NotFoundError: 0031');
    // No link was made, so nothing to report or close (e.g. chooser dismissed).
    expect(captureError).not.toHaveBeenCalled();
    expect(disconnectPM5Mock).not.toHaveBeenCalled();
  });

  it('a failed 0031 subscription is an error, is reported and closes the link', async () => {
    failSubscribe = new Set(['0031']);
    const { result } = await connectedHook();
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('startNotifications failed for 0031');
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Bluetooth',
    });
    expect(captureError.mock.calls[0][0].message).toBe(
      'startNotifications failed for 0031'
    );
    expect(disconnectPM5Mock).toHaveBeenCalledWith(fakeDevice);
  });
});

describe('usePM5 finish() — manual END rescue', () => {
  it('builds the summary from what has been seen instead of discarding the session', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 300, dist: 1250, pace: 12500 });
    rowStroke({ t: 600, dist: 2600, pace: 11500 });
    expect(result.current.status).toBe('rowing');

    act(() => result.current.finish());

    expect(result.current.status).toBe('finished');
    expect(result.current.summary).toEqual({
      distance: 2600,
      elapsedTime: 600,
      elapsedStr: '10:00',
      avgWatts: 203,
      avgPace: 12000,
      avgSpm: 24,
      maxWatts: 230,
      calories: 0,
    });
  });

  it('null-safes a finish with no metrics ever received (PM5 dead before first packet)', async () => {
    const { result } = await connectedHook();

    act(() => result.current.finish());

    expect(result.current.status).toBe('finished');
    expect(result.current.summary).toEqual({
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

  it('reset() clears the summary and disconnects', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 10, dist: 50 });
    act(() => result.current.finish());
    expect(result.current.summary).not.toBeNull();

    act(() => result.current.reset());

    expect(result.current.summary).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(disconnectPM5Mock).toHaveBeenCalled();
  });

  it('a fresh connect starts a new piece', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 10, dist: 50 });
    act(() => result.current.finish());

    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.summary).toBeNull();
    rowStroke({ t: 5, dist: 20 });
    emit('0031', general({ t: 6, dist: 22, state: 10, rowing: 0 }));
    expect(result.current.summary.distance).toBe(22);
  });
});

describe('usePM5 stroke data (0035)', () => {
  it('subscribes to both stroke characteristics', async () => {
    await connectedHook();
    expect(subscriptions['0035']).toBeDefined();
    expect(subscriptions['0036']).toBeDefined();
  });

  it('exposes the first stroke of a connection', async () => {
    const { result } = await connectedHook();
    expect(result.current.stroke).toBeNull();

    emit('0035', stroke({ t: 10, count: 1 }));

    expect(result.current.stroke).toEqual(
      expect.objectContaining({
        elapsedTime: 10,
        driveTime: 0.8,
        strokeRecoveryTime: 1.6,
        strokeCount: 1,
      })
    );
    expect(result.current.stroke.driveLength).toBeCloseTo(1.12);
  });

  // The central test of the slice: 0035 has its own slot, so it is not subject
  // to mergeStatus's 1.0 s freshness window and does not blank between strokes.
  it('does not expire while 0031 packets keep arriving', async () => {
    const { result } = await connectedHook();
    emit('0035', stroke({ t: 10, count: 7 }));
    const shown = result.current.stroke;

    emit('0031', general({ t: 13, dist: 50, state: 1, rowing: 1 }));
    emit('0031', general({ t: 16, dist: 60, state: 1, rowing: 1 }));
    emit('0031', general({ t: 19, dist: 70, state: 1, rowing: 1 }));

    expect(result.current.stroke).toBe(shown);
    expect(result.current.stroke.strokeCount).toBe(7);
  });

  it('is replaced by the next stroke', async () => {
    const { result } = await connectedHook();
    emit('0035', stroke({ t: 10, count: 7, driveTime: 0.8, recovery: 1.6 }));
    emit('0035', stroke({ t: 13, count: 8, driveTime: 0.75, recovery: 1.8 }));
    expect(result.current.stroke.strokeCount).toBe(8);
    expect(result.current.stroke.driveTime).toBeCloseTo(0.75);
  });

  it('keeps the same object for a duplicate stroke count', async () => {
    const { result } = await connectedHook();
    emit('0035', stroke({ t: 10, count: 7 }));
    const shown = result.current.stroke;
    emit('0035', stroke({ t: 10, count: 7 }));
    expect(result.current.stroke).toBe(shown);
  });

  it('drops an out-of-order stroke with a lower count', async () => {
    const { result } = await connectedHook();
    emit('0035', stroke({ t: 10, count: 9 }));
    const shown = result.current.stroke;
    emit('0035', stroke({ t: 11, count: 8 }));
    expect(result.current.stroke).toBe(shown);
  });

  // A rearm restarts both counters, which is the only new-piece boundary the
  // hook has; the clock going backwards is what lets the next piece in.
  it('accepts a new piece whose counters restarted', async () => {
    const { result } = await connectedHook();
    emit('0035', stroke({ t: 300, count: 90 }));
    emit('0031', general({ t: 301, dist: 1200, state: 13, rowing: 0 }));
    emit('0035', stroke({ t: 2, count: 1 }));
    expect(result.current.stroke.strokeCount).toBe(1);
    expect(result.current.stroke.elapsedTime).toBe(2);
  });

  it('accepts a 0035 before any 0031 has arrived', async () => {
    const { result } = await connectedHook();
    emit('0035', stroke({ t: 3, count: 1 }));
    expect(result.current.stroke).not.toBeNull();
    expect(result.current.metrics).toBeNull();
    expect(result.current.status).toBe('connected');
  });

  it('clears the stroke on disconnect and on reset', async () => {
    const { result } = await connectedHook();
    emit('0035', stroke({ t: 10, count: 2 }));
    act(() => result.current.disconnect());
    expect(result.current.stroke).toBeNull();

    await act(async () => {
      await result.current.connect();
    });
    emit('0035', stroke({ t: 10, count: 2 }));
    act(() => result.current.reset());
    expect(result.current.stroke).toBeNull();
  });

  it('clears the stroke when the GATT link drops on its own', async () => {
    const { result } = await connectedHook();
    emit('0031', general({ t: 10, dist: 50, state: 1, rowing: 1 }));
    emit('0035', stroke({ t: 10, count: 5 }));
    expect(result.current.stroke).not.toBeNull();
    expect(result.current.metrics).not.toBeNull();
    expect(result.current.status).toBe('rowing');

    fireGattDisconnected();

    expect(result.current.stroke).toBeNull();
    expect(result.current.metrics).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('leaves no stale stroke across a disconnect and reconnect', async () => {
    const { result } = await connectedHook();
    emit('0035', stroke({ t: 10, count: 4 }));
    act(() => result.current.disconnect());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.stroke).toBeNull();
  });

  // Decision 3: 0036 is subscribed and parsed, and nothing is rendered from it.
  it('parses 0036 without putting it on any state key', async () => {
    const { result } = await connectedHook();
    const parsed = subscriptions['0036'].parser(
      addStroke({ t: 5, power: 240 })
    );
    expect(parsed.strokePower).toBe(240);
    emit('0036', addStroke({ t: 5, power: 240 }));
    expect(result.current.stroke).toBeNull();
    expect(result.current.metrics).toBeNull();
  });

  it('a stroke never reaches the built summary', async () => {
    const { result } = await connectedHook();
    rowStroke({ t: 10, dist: 50 });
    emit('0035', stroke({ t: 10, count: 3 }));
    act(() => result.current.finish());
    expect(result.current.summary).toEqual({
      distance: 50,
      elapsedTime: 10,
      elapsedStr: '00:10',
      avgWatts: 203,
      avgPace: 12000,
      avgSpm: 24,
      maxWatts: 203,
      calories: 0,
    });
  });
});

describe('usePM5 missing stroke characteristics', () => {
  it('without 0035 the connection and the status tiles still work', async () => {
    const { result } = await connectedHook({ ...ALL_CHARS, strokeData: null });
    expect(result.current.status).toBe('connected');
    // Exactly once: a short-packet flood or a double report would otherwise
    // pass toHaveBeenCalledWith unnoticed.
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Bluetooth',
      char: '0035',
    });

    emit('0031', general({ t: 10, dist: 50, state: 1, rowing: 1 }));
    expect(result.current.status).toBe('rowing');
    expect(result.current.metrics.distance).toBe(50);
    expect(result.current.stroke).toBeNull();
  });

  it('without 0036 the connection still succeeds and the gap is reported', async () => {
    const { result } = await connectedHook({
      ...ALL_CHARS,
      additionalStrokeData: null,
    });
    expect(result.current.status).toBe('connected');
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Bluetooth',
      char: '0036',
    });

    // The status tiles are what this criterion is about, so drive them off a
    // 0031; the 0035 path is proven separately.
    emit('0031', general({ t: 10, dist: 50, state: 1, rowing: 1 }));
    expect(result.current.status).toBe('rowing');
    expect(result.current.metrics.distance).toBe(50);

    emit('0035', stroke({ t: 10, count: 1 }));
    expect(result.current.stroke).not.toBeNull();
  });

  it('a failed 0035 subscription is reported and connect carries on', async () => {
    failSubscribe = new Set(['0035']);
    const { result } = await connectedHook();
    expect(result.current.status).toBe('connected');
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Bluetooth',
      char: '0035',
    });
    expect(result.current.stroke).toBeNull();
  });

  it('a failed 0036 subscription is reported and connect carries on', async () => {
    failSubscribe = new Set(['0036']);
    const { result } = await connectedHook();
    expect(result.current.status).toBe('connected');
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Bluetooth',
      char: '0036',
    });

    // 0036 failing costs nothing else: 0035 still feeds the tiles.
    emit('0035', stroke({ t: 10, count: 1 }));
    expect(result.current.stroke).not.toBeNull();
  });

  it('reports the original fetch rejection for a missing 0035', async () => {
    const original = new Error('NotFoundError: 0035');
    await connectedHook(
      { ...ALL_CHARS, strokeData: null },
      {
        additionalStatus1: null,
        additionalStatus2: null,
        workoutSummary: null,
        strokeData: original,
        additionalStrokeData: null,
      }
    );
    expect(captureError).toHaveBeenCalledWith(original, {
      source: 'pm5Bluetooth',
      char: '0035',
    });
  });

  it('a PM5 exposing neither stroke characteristic costs two reports', async () => {
    const { result } = await connectedHook({
      ...ALL_CHARS,
      strokeData: null,
      additionalStrokeData: null,
    });
    expect(result.current.status).toBe('connected');
    expect(captureError).toHaveBeenCalledTimes(2);
    expect(result.current.stroke).toBeNull();

    emit('0031', general({ t: 10, dist: 50, state: 1, rowing: 1 }));
    expect(result.current.metrics.distance).toBe(50);
  });
});

describe('usePM5 connect errors (AC-T2)', () => {
  it('keeps a string code from pm5Bluetooth next to the message', async () => {
    const err = new Error('Web Bluetooth is not supported');
    err.code = 'PM5_UNSUPPORTED';
    connectToPM5Mock.mockRejectedValue(err);
    const { result } = renderHook(() => usePM5());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Web Bluetooth is not supported');
    expect(result.current.errorCode).toBe('PM5_UNSUPPORTED');

    await act(async () => {
      result.current.reset();
    });
    expect(result.current.errorCode).toBeNull();
  });

  it("ignores a DOMException's numeric legacy code", async () => {
    connectToPM5Mock.mockRejectedValue(
      new globalThis.DOMException(
        'User cancelled the requestDevice() chooser.',
        'NotFoundError'
      )
    );
    const { result } = renderHook(() => usePM5());
    await act(async () => {
      await result.current.connect();
    });
    expect(result.current.error).toBe(
      'User cancelled the requestDevice() chooser.'
    );
    expect(result.current.errorCode).toBeNull();
  });
});

// The Capacitor plugin shims navigator.bluetooth, so there is one BLE code path
// and the thing worth pinning is the shim's contract. The file's module-level
// Capacitor mock reports web, so this needs its own mocks and its own import.
//
// This block MUST stay last in the file. vi.resetModules() plus vi.doMock and a
// dynamic import only leave the blocks above untouched because they have
// already captured the statically-imported usePM5; running this earlier, or
// with --sequence.shuffle, would hand them the native build.
describe('usePM5 on the Capacitor path', () => {
  afterEach(() => {
    vi.doUnmock('@capacitor/core');
    vi.doUnmock('@capacitor/app');
    vi.doUnmock('@capgo/capacitor-bluetooth-low-energy');
    vi.resetModules();
  });

  // Mount the hook with Capacitor reporting native. `listeners` collects the
  // App events the hook registers, so a test can fire one.
  async function mountNative(BluetoothLowEnergy) {
    const listeners = {};
    vi.resetModules();
    vi.doMock('@capacitor/core', () => ({
      Capacitor: { isNativePlatform: () => true },
    }));
    vi.doMock('@capacitor/app', () => ({
      App: {
        addListener: vi.fn(async (event, cb) => {
          listeners[event] = cb;
          return { remove: vi.fn() };
        }),
      },
    }));
    vi.doMock('@capgo/capacitor-bluetooth-low-energy', () => ({
      BluetoothLowEnergy,
    }));

    const { usePM5: nativeUsePM5 } = await import('../usePM5');
    let rendered;
    await act(async () => {
      rendered = renderHook(() => nativeUsePM5());
    });
    return { rendered, listeners };
  }

  const workingBle = () => ({
    requestPermissions: vi.fn().mockResolvedValue(undefined),
    shimWebBluetooth: vi.fn(),
  });

  it('requests BLE permissions and then installs the Web Bluetooth shim', async () => {
    const order = [];
    await mountNative({
      requestPermissions: vi.fn(async () => {
        order.push('requestPermissions');
      }),
      shimWebBluetooth: vi.fn(() => {
        order.push('shimWebBluetooth');
      }),
    });

    expect(order).toEqual(['requestPermissions', 'shimWebBluetooth']);
  });

  it('surfaces a permission failure as the hook error instead of throwing', async () => {
    const { rendered } = await mountNative({
      requestPermissions: vi.fn().mockRejectedValue(new Error('denied')),
      shimWebBluetooth: vi.fn(),
    });

    expect(rendered.result.current.error).toBe('denied');
  });

  it('clears the live state and the stroke when the app is paused', async () => {
    const { rendered, listeners } = await mountNative(workingBle());
    connectToPM5Mock.mockResolvedValue({
      device: fakeDevice,
      chars: ALL_CHARS,
    });
    await act(async () => {
      await rendered.result.current.connect();
    });

    emit('0031', general({ t: 10, dist: 50, state: 1, rowing: 1 }));
    emit('0035', stroke({ t: 10, count: 3 }));
    expect(rendered.result.current.stroke).not.toBeNull();
    expect(rendered.result.current.metrics).not.toBeNull();
    expect(rendered.result.current.status).toBe('rowing');

    act(() => listeners.pause());

    expect(rendered.result.current.stroke).toBeNull();
    expect(rendered.result.current.metrics).toBeNull();
    expect(rendered.result.current.status).toBe('idle');
    expect(disconnectPM5Mock).toHaveBeenCalledWith(fakeDevice);
  });

  it('ignores a pause with no monitor connected', async () => {
    const { rendered, listeners } = await mountNative(workingBle());

    act(() => listeners.pause());

    expect(rendered.result.current.status).toBe('idle');
    expect(disconnectPM5Mock).not.toHaveBeenCalled();
  });
});
