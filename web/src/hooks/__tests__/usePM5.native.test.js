import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The Android path: Connect opens the PM5 list. pm5Scan's three functions are
// mocked so the real hook logic, the real row merge and the real timing
// constants run against scan results the test sends.
const scan = vi.hoisted(() => ({
  check: vi.fn(),
  start: vi.fn(),
  connectChosen: vi.fn(),
}));
const disconnectPM5Mock = vi.hoisted(() => vi.fn());
const subscribeMock = vi.hoisted(() => vi.fn());
const app = vi.hoisted(() => ({ listeners: {} }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((event, fn) => {
      app.listeners[event] = fn;
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
}));

vi.mock('@capgo/capacitor-bluetooth-low-energy', () => ({
  BluetoothLowEnergy: {
    requestPermissions: vi.fn(() => Promise.resolve({})),
    shimWebBluetooth: vi.fn(),
  },
}));

vi.mock('../../services/pm5Scan', async () => {
  const actual = await vi.importActual('../../services/pm5Scan');
  return {
    ...actual,
    checkScanPrerequisites: (...args) => scan.check(...args),
    startPM5Scan: (...args) => scan.start(...args),
    connectToChosenPM5: (...args) => scan.connectChosen(...args),
  };
});

vi.mock('../../services/pm5Bluetooth', async () => {
  const actual = await vi.importActual('../../services/pm5Bluetooth');
  return {
    ...actual,
    subscribe: (...args) => subscribeMock(...args),
    disconnectPM5: (...args) => disconnectPM5Mock(...args),
  };
});

vi.mock('../../utils/sentry.js', () => ({ captureError: vi.fn() }));

import { usePM5 } from '../usePM5';
import { LAST_PM5_ID_KEY, writeLastPm5Id } from '../../utils/pm5LastUsed.js';
import {
  PM5_STALE_MS,
  PM5_EMPTY_AFTER_MS,
  PM5_CONNECT_FAILED,
} from '../../services/pm5Scan';

const CHARS = {
  generalStatus: { id: '0031' },
  additionalStatus1: { id: '0032' },
  additionalStatus2: { id: '0033' },
  workoutSummary: { id: '0039' },
};

let onSighting;
let scanSignal;
let stopMock;
let renders;
// subscribe() calls by characteristic id, and gates that hold one open.
let subs;
let gates;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function coded(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

async function openList() {
  renders = 0;
  const rendered = renderHook(() => {
    renders += 1;
    return usePM5();
  });
  await act(async () => {
    await rendered.result.current.connect();
  });
  return rendered;
}

function see(deviceId, name) {
  act(() => onSighting({ deviceId, name }));
}

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

// A device that can fire gattserverdisconnected to every listener ever
// added, as the shim's reused device object does.
function fakeDevice() {
  const listeners = [];
  return {
    gatt: {},
    addEventListener: vi.fn((type, fn) => listeners.push({ type, fn })),
    dispatch(type) {
      listeners.filter((l) => l.type === type).forEach((l) => l.fn());
    },
  };
}

function connected(device = fakeDevice()) {
  return { device, chars: CHARS, errors: {} };
}

// A 0031 sample from a working, moving flywheel.
const WORKING = {
  elapsedTime: 10,
  distance: 50,
  workoutType: 0,
  workoutState: 1,
  rowingState: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  app.listeners = {};
  stopMock = vi.fn();
  scan.check.mockReset().mockResolvedValue({ locationOff: false });
  scan.start.mockReset().mockImplementation(async (fn, options) => {
    onSighting = fn;
    scanSignal = options?.signal;
    return stopMock;
  });
  scan.connectChosen.mockReset();
  subs = {};
  gates = {};
  subscribeMock.mockReset().mockImplementation(async (char, parser, cb) => {
    subs[char.id] = cb;
    if (gates[char.id]) await gates[char.id];
  });
  disconnectPM5Mock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePM5 on Android: the PM5 list', () => {
  it('Connect opens the list instead of the browser chooser', async () => {
    const { result } = await openList();
    expect(result.current.status).toBe('choosing');
    expect(result.current.scanPhase).toBe('searching');
    expect(result.current.monitors).toEqual([]);
    expect(scan.start).toHaveBeenCalledTimes(1);
  });

  it('passes Location off through for the empty state', async () => {
    scan.check.mockResolvedValue({ locationOff: true });
    const { result } = await openList();
    expect(result.current.locationOff).toBe(true);
  });

  // AC4
  it('shows rows as they are found, while the scan is still running', async () => {
    const { result } = await openList();
    see('AA', 'PM5 431719123 Row');
    expect(result.current.monitors).toEqual([
      { id: 'AA', name: 'PM5 431719123 Row', stale: false },
    ]);
    see('BB', null);
    expect(result.current.monitors).toEqual([
      { id: 'AA', name: 'PM5 431719123 Row', stale: false },
      { id: 'BB', name: null, stale: false },
    ]);
    expect(stopMock).not.toHaveBeenCalled();
    expect(result.current.scanPhase).toBe('searching');
  });

  // AC5
  it('redraws once for a new monitor, not once per scan result', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    const after = renders;
    for (let i = 0; i < 20; i += 1) see('AA', 'PM5 1 Row');
    expect(renders).toBe(after);
    see('BB', 'PM5 2 Row');
    for (let i = 0; i < 20; i += 1) see('BB', 'PM5 2 Row');
    expect(renders).toBe(after + 1);
    expect(result.current.monitors).toHaveLength(2);
  });

  // AC6, as changed at Gate 3: a monitor out of range stays in place, stale.
  it('marks a monitor not seen for 5 s stale in place, and revives it', async () => {
    const { result } = await openList();
    const rows = () => result.current.monitors.map((m) => [m.id, m.stale]);
    see('AA', 'PM5 1 Row');
    see('BB', 'PM5 2 Row');
    await advance(3000);
    see('BB', 'PM5 2 Row');
    await advance(PM5_STALE_MS - 3000 - 1000);
    expect(rows()).toEqual([
      ['AA', false],
      ['BB', false],
    ]);
    await advance(1000);
    expect(rows()).toEqual([
      ['AA', true],
      ['BB', false],
    ]);
    see('CC', 'PM5 3 Row');
    see('AA', 'PM5 1 Row');
    expect(rows()).toEqual([
      ['AA', false],
      ['BB', false],
      ['CC', false],
    ]);
  });

  it('ignores a tap on a stale row', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    await advance(PM5_STALE_MS);
    expect(result.current.monitors[0].stale).toBe(true);
    act(() => {
      result.current.choose('AA');
    });
    expect(scan.connectChosen).not.toHaveBeenCalled();
    expect(result.current.connectingId).toBeNull();
  });

  it('says none was found once every row has been stale for 10 s', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    await advance(PM5_STALE_MS);
    expect(result.current.monitors).toHaveLength(1);
    await advance(PM5_EMPTY_AFTER_MS - 1000);
    expect(result.current.scanPhase).toBe('searching');
    await advance(1000);
    expect(result.current.scanPhase).toBe('empty');
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await result.current.retryScan();
    });
    expect(result.current.monitors).toEqual([]);
    expect(result.current.scanPhase).toBe('searching');
  });

  // AC2
  it('choose connects the tapped monitor, stops the scan and goes live', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    see('BB', 'PM5 2 Row');
    const pending = deferred();
    scan.connectChosen.mockReturnValue(pending.promise);
    act(() => {
      result.current.choose('BB');
    });
    expect(scan.connectChosen).toHaveBeenCalledTimes(1);
    expect(scan.connectChosen.mock.calls[0][0]).toBe('BB');
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(result.current.connectingId).toBe('BB');
    expect(result.current.status).toBe('choosing');

    await act(async () => {
      pending.resolve(connected());
      await pending.promise;
    });
    expect(result.current.status).toBe('connected');
    expect(result.current.connectingId).toBeNull();
    expect(result.current.monitors).toEqual([]);
    expect(subscribeMock.mock.calls[0][0]).toBe(CHARS.generalStatus);
    expect(vi.getTimerCount()).toBe(0);
  });

  // AC3
  it('never connects a monitor nobody chose, even when it is the only one', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    for (let i = 0; i < 4; i += 1) {
      await advance(2000);
      see('AA', 'PM5 1 Row');
    }
    expect(result.current.monitors).toHaveLength(1);
    expect(result.current.status).toBe('choosing');
    act(() => {
      result.current.choose('ZZ');
    });
    expect(scan.connectChosen).not.toHaveBeenCalled();
  });

  it('auto-chooses the remembered PM5 when it is in the live list', async () => {
    writeLastPm5Id('BB');
    const { result } = await openList();
    const pending = deferred();
    scan.connectChosen.mockReturnValue(pending.promise);
    see('AA', 'PM5 1 Row');
    expect(scan.connectChosen).not.toHaveBeenCalled();
    see('BB', 'PM5 2 Row');
    expect(scan.connectChosen).toHaveBeenCalledTimes(1);
    expect(scan.connectChosen.mock.calls[0][0]).toBe('BB');
    await act(async () => {
      pending.resolve(connected());
      await pending.promise;
    });
    expect(result.current.status).toBe('connected');
    expect(window.localStorage.getItem(LAST_PM5_ID_KEY)).toBe('BB');
  });

  it('does not auto-choose a remembered PM5 that is not in the list', async () => {
    writeLastPm5Id('ZZ');
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    expect(scan.connectChosen).not.toHaveBeenCalled();
    expect(result.current.status).toBe('choosing');
  });

  it('a failed auto-choose returns to the list and does not loop', async () => {
    writeLastPm5Id('AA');
    const { result } = await openList();
    const pending = deferred();
    scan.connectChosen.mockReturnValue(pending.promise);
    see('AA', 'PM5 1 Row');
    expect(scan.connectChosen).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new Error('nope'));
      try {
        await pending.promise;
      } catch {
        // the hook handles the rejection
      }
    });
    expect(result.current.status).toBe('choosing');
    // A rescan starts; seeing the same id again must not reconnect on its own.
    see('AA', 'PM5 1 Row');
    await advance(2000);
    see('AA', 'PM5 1 Row');
    expect(scan.connectChosen).toHaveBeenCalledTimes(1);
  });

  it('ignores further taps while a connect is in progress', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    see('BB', 'PM5 2 Row');
    scan.connectChosen.mockReturnValue(new Promise(() => {}));
    act(() => {
      result.current.choose('AA');
      result.current.choose('AA');
      result.current.choose('BB');
    });
    expect(scan.connectChosen).toHaveBeenCalledTimes(1);
    expect(result.current.connectingId).toBe('AA');
  });

  it('a failed connect returns to the list with the error and scans again', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    see('BB', 'PM5 2 Row');
    scan.connectChosen.mockRejectedValue(coded(PM5_CONNECT_FAILED));
    await act(async () => {
      await result.current.choose('AA');
    });
    expect(result.current.status).toBe('choosing');
    expect(result.current.errorCode).toBe(PM5_CONNECT_FAILED);
    expect(result.current.connectingId).toBeNull();
    expect(result.current.monitors.map((m) => m.id)).toEqual(['AA', 'BB']);
    expect(scan.start).toHaveBeenCalledTimes(2);
    // The kept rows get a fresh window rather than expiring at once.
    await advance(PM5_STALE_MS - 1000);
    expect(result.current.monitors).toHaveLength(2);
  });

  it('a failed 0031 subscription after connecting counts as a failed connect', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    const link = connected();
    scan.connectChosen.mockResolvedValue(link);
    subscribeMock.mockRejectedValueOnce(new Error('startNotifications failed'));
    await act(async () => {
      await result.current.choose('AA');
    });
    expect(disconnectPM5Mock).toHaveBeenCalledWith(link.device);
    expect(result.current.status).toBe('choosing');
    expect(result.current.errorCode).toBe(PM5_CONNECT_FAILED);
    expect(scan.start).toHaveBeenCalledTimes(2);
  });

  it('says none was found after 10 s with no rows, and stops scanning', async () => {
    const { result } = await openList();
    await advance(PM5_EMPTY_AFTER_MS - 1);
    expect(result.current.scanPhase).toBe('searching');
    await advance(1);
    expect(result.current.scanPhase).toBe('empty');
    expect(result.current.status).toBe('choosing');
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(scanSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Try again clears the list and searches again', async () => {
    const { result } = await openList();
    await advance(PM5_EMPTY_AFTER_MS);
    expect(result.current.scanPhase).toBe('empty');
    await act(async () => {
      await result.current.retryScan();
    });
    expect(result.current.scanPhase).toBe('searching');
    expect(scan.start).toHaveBeenCalledTimes(2);
    see('AA', 'PM5 1 Row');
    expect(result.current.monitors).toHaveLength(1);
  });

  it('Cancel closes the list, stops scanning and connects nothing', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    act(() => result.current.cancelScan());
    expect(result.current.status).toBe('idle');
    expect(result.current.monitors).toEqual([]);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(scan.connectChosen).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backgrounding the app with the list open stops scanning', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    act(() => app.listeners.pause());
    expect(result.current.status).toBe('idle');
    expect(result.current.monitors).toEqual([]);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a connect that completes after the app was backgrounded is disconnected', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    const pending = deferred();
    scan.connectChosen.mockReturnValue(pending.promise);
    act(() => {
      result.current.choose('AA');
    });
    const { signal } = scan.connectChosen.mock.calls[0][1];
    act(() => app.listeners.pause());
    expect(signal.aborted).toBe(true);
    const link = connected();
    await act(async () => {
      pending.resolve(link);
      await pending.promise;
    });
    expect(disconnectPM5Mock).toHaveBeenCalledWith(link.device);
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('a cancel during the scan start stops the scan when it arrives', async () => {
    const started = deferred();
    scan.start.mockImplementation((fn) => {
      onSighting = fn;
      return started.promise;
    });
    const { result } = renderHook(() => usePM5());
    act(() => {
      result.current.connect();
    });
    await act(async () => {});
    act(() => result.current.cancelScan());
    await act(async () => {
      started.resolve(stopMock);
      await started.promise;
    });
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmounting stops the scan and disconnects a connect that lands late', async () => {
    const { result, unmount } = await openList();
    see('AA', 'PM5 1 Row');
    const pending = deferred();
    scan.connectChosen.mockReturnValue(pending.promise);
    act(() => {
      result.current.choose('AA');
    });
    const { signal } = scan.connectChosen.mock.calls[0][1];
    unmount();
    expect(signal.aborted).toBe(true);
    const link = connected();
    await act(async () => {
      pending.resolve(link);
      await pending.promise;
    });
    expect(disconnectPM5Mock).toHaveBeenCalledWith(link.device);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmounting mid-scan stops the scan and its sweep', async () => {
    const { unmount } = await openList();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(scanSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a failed prerequisite shows its error on the Connect screen', async () => {
    scan.check.mockRejectedValue(coded('PM5_BLUETOOTH_OFF'));
    const { result } = await openList();
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('PM5_BLUETOOTH_OFF');
    expect(scan.start).not.toHaveBeenCalled();
  });

  it('a scan that cannot start shows its error on the Connect screen', async () => {
    scan.start.mockRejectedValue(coded('PM5_PERMISSION_DENIED'));
    const { result } = await openList();
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('PM5_PERMISSION_DENIED');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['PM5_BLE_UNAVAILABLE', 'PM5_SCAN_FAILED'])(
    'a prerequisite failing with %s reaches the error state',
    async (code) => {
      scan.check.mockRejectedValue(coded(code));
      const { result } = await openList();
      expect(result.current.status).toBe('error');
      expect(result.current.errorCode).toBe(code);
      expect(scan.start).not.toHaveBeenCalled();
    }
  );

  it('a scan start failing with PM5_SCAN_FAILED reaches the error state', async () => {
    scan.start.mockRejectedValue(coded('PM5_SCAN_FAILED'));
    const { result } = await openList();
    expect(result.current.status).toBe('error');
    expect(result.current.errorCode).toBe('PM5_SCAN_FAILED');
  });
});

describe('usePM5 on Android: late events from an abandoned attempt', () => {
  it('a disconnect event after a failed 0031 subscribe leaves the list up', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    const link = connected();
    scan.connectChosen.mockResolvedValue(link);
    subscribeMock.mockRejectedValueOnce(new Error('startNotifications failed'));
    await act(async () => {
      await result.current.choose('AA');
    });
    act(() => link.device.dispatch('gattserverdisconnected'));
    expect(result.current.status).toBe('choosing');
    expect(result.current.errorCode).toBe(PM5_CONNECT_FAILED);
    expect(result.current.monitors.map((m) => m.id)).toEqual(['AA']);
  });

  it('an earlier session’s listener on the same device ignores a later failed connect', async () => {
    const device = fakeDevice();
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    scan.connectChosen.mockResolvedValue(connected(device));
    await act(async () => {
      await result.current.choose('AA');
    });
    expect(result.current.status).toBe('connected');
    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');

    // The first success remembered AA, so the next Start would auto-choose
    // it. Set the failure first, then let the sighting fire that attempt.
    scan.connectChosen.mockRejectedValue(coded(PM5_CONNECT_FAILED));
    await act(async () => {
      await result.current.connect();
    });
    await act(async () => {
      see('AA', 'PM5 1 Row');
    });
    act(() => device.dispatch('gattserverdisconnected'));
    expect(result.current.status).toBe('choosing');
    expect(result.current.errorCode).toBe(PM5_CONNECT_FAILED);
  });

  it('the current connection still goes idle when its PM5 drops', async () => {
    const device = fakeDevice();
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    scan.connectChosen.mockResolvedValue(connected(device));
    await act(async () => {
      await result.current.choose('AA');
    });
    act(() => device.dispatch('gattserverdisconnected'));
    expect(result.current.status).toBe('idle');
  });

  it('a 0031 packet after a cancel during the optional subscribes changes nothing', async () => {
    const { result } = await openList();
    see('AA', 'PM5 1 Row');
    const link = connected();
    scan.connectChosen.mockResolvedValue(link);
    const gate = deferred();
    gates['0032'] = gate.promise;
    await act(async () => {
      result.current.choose('AA');
    });
    expect(subs['0031']).toBeDefined();
    act(() => result.current.cancelScan());
    act(() => subs['0031'](WORKING));
    expect(result.current.status).toBe('idle');
    expect(result.current.metrics).toBeNull();
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(disconnectPM5Mock).toHaveBeenCalledWith(link.device);
    expect(result.current.status).toBe('idle');
  });
});

describe('usePM5 on Android: a tap while the rescan is still starting', () => {
  async function failedOnce() {
    const rendered = await openList();
    see('AA', 'PM5 1 Row');
    see('BB', 'PM5 2 Row');
    scan.connectChosen.mockRejectedValueOnce(coded(PM5_CONNECT_FAILED));
    return rendered;
  }

  it('during the prerequisite check: no scan starts, none runs after connecting', async () => {
    const { result } = await failedOnce();
    const check = deferred();
    scan.check.mockReturnValueOnce(check.promise);
    await act(async () => {
      await result.current.choose('AA');
    });
    expect(result.current.errorCode).toBe(PM5_CONNECT_FAILED);
    const pending = deferred();
    scan.connectChosen.mockReturnValueOnce(pending.promise);
    act(() => {
      result.current.choose('BB');
    });
    expect(scan.connectChosen).toHaveBeenCalledTimes(2);
    await act(async () => {
      check.resolve({ locationOff: false });
      await check.promise;
    });
    expect(scan.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(connected());
      await pending.promise;
    });
    expect(result.current.status).toBe('connected');
    expect(scan.start).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('during the start-rate wait: the waiting scan is stopped, none runs after connecting', async () => {
    const { result } = await failedOnce();
    const waitingStop = vi.fn();
    let waitingSignal;
    // Stands in for startPM5Scan waiting for a slot: it settles only when
    // its signal is aborted, as the real one does.
    scan.start.mockImplementationOnce(
      (fn, { signal }) =>
        new Promise((resolve) => {
          waitingSignal = signal;
          signal.addEventListener('abort', () => resolve(waitingStop));
        })
    );
    await act(async () => {
      await result.current.choose('AA');
    });
    expect(scan.start).toHaveBeenCalledTimes(2);
    expect(result.current.monitors).toHaveLength(2);
    const pending = deferred();
    scan.connectChosen.mockReturnValueOnce(pending.promise);
    await act(async () => {
      result.current.choose('BB');
    });
    expect(waitingSignal.aborted).toBe(true);
    expect(waitingStop).toHaveBeenCalled();
    await act(async () => {
      pending.resolve(connected());
      await pending.promise;
    });
    expect(result.current.status).toBe('connected');
    expect(scan.start).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
