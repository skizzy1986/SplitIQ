import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The plugin is a hand-written fake that records call order, so the tests can
// pin what the real plugin needs: listen first, stop the old scan, then start.
const ble = vi.hoisted(() => ({ plugin: {}, calls: [], listeners: [] }));
const sentry = vi.hoisted(() => ({ captureError: vi.fn() }));

vi.mock('@capgo/capacitor-bluetooth-low-energy', () => ({
  BluetoothLowEnergy: ble.plugin,
}));
vi.mock('../../utils/sentry.js', () => sentry);

const PM5_DEVICE = 'ce060000-43e5-11e4-916c-0800200c9a66';
const ROW_SERVICE = 'ce060030-43e5-11e4-916c-0800200c9a66';

function resetPlugin() {
  ble.calls = [];
  ble.listeners = [];
  const record = (name, value) =>
    vi.fn((...args) => {
      ble.calls.push(name);
      return Promise.resolve(
        typeof value === 'function' ? value(...args) : value
      );
    });
  Object.assign(ble.plugin, {
    isAvailable: record('isAvailable', { available: true }),
    initialize: record('initialize', undefined),
    isEnabled: record('isEnabled', { enabled: true }),
    requestPermissions: record('requestPermissions', {
      bluetooth: 'granted',
      location: 'granted',
    }),
    isLocationEnabled: record('isLocationEnabled', { enabled: true }),
    stopScan: record('stopScan', undefined),
    startScan: record('startScan', undefined),
    connect: record('connect', undefined),
    disconnect: record('disconnect', undefined),
    addListener: vi.fn((event, fn) => {
      ble.calls.push(`addListener:${event}`);
      const entry = { event, fn, removed: false };
      entry.remove = vi.fn(() => {
        entry.removed = true;
        return Promise.resolve();
      });
      ble.listeners.push(entry);
      return Promise.resolve({ remove: entry.remove });
    }),
  });
}

const live = (event) =>
  ble.listeners.filter((l) => l.event === event && !l.removed);
const emit = (event, payload) =>
  live(event).forEach((l) => {
    l.fn(payload);
  });

let mod;

beforeEach(async () => {
  resetPlugin();
  sentry.captureError.mockReset();
  // The start-rate guard is module state; every test starts with none.
  vi.resetModules();
  mod = await import('../pm5Scan.js');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkScanPrerequisites', () => {
  it('resolves when Bluetooth is ready and Location is on', async () => {
    await expect(mod.checkScanPrerequisites()).resolves.toEqual({
      locationOff: false,
    });
    expect(ble.plugin.initialize).toHaveBeenCalledWith({ mode: 'central' });
  });

  it('reports Location off without blocking', async () => {
    ble.plugin.isLocationEnabled.mockResolvedValue({ enabled: false });
    await expect(mod.checkScanPrerequisites()).resolves.toEqual({
      locationOff: true,
    });
  });

  it('initializes on every scan, not once', async () => {
    await mod.checkScanPrerequisites();
    await mod.checkScanPrerequisites();
    expect(ble.plugin.initialize).toHaveBeenCalledTimes(2);
  });

  it('throws PM5_BLE_UNAVAILABLE when the phone has no BLE', async () => {
    ble.plugin.isAvailable.mockResolvedValue({ available: false });
    await expect(mod.checkScanPrerequisites()).rejects.toMatchObject({
      code: 'PM5_BLE_UNAVAILABLE',
    });
  });

  it('throws PM5_SCAN_FAILED when initialize rejects', async () => {
    const cause = new Error('Bluetooth is not available on this device');
    ble.plugin.initialize.mockRejectedValue(cause);
    await expect(mod.checkScanPrerequisites()).rejects.toMatchObject({
      code: 'PM5_SCAN_FAILED',
      cause,
    });
  });

  it('throws PM5_BLUETOOTH_OFF when Bluetooth is off', async () => {
    ble.plugin.isEnabled.mockResolvedValue({ enabled: false });
    await expect(mod.checkScanPrerequisites()).rejects.toMatchObject({
      code: 'PM5_BLUETOOTH_OFF',
    });
  });

  // Android reports 'prompt', never 'denied', for a refused permission.
  it('throws PM5_PERMISSION_DENIED unless Bluetooth is granted', async () => {
    ble.plugin.requestPermissions.mockResolvedValue({
      bluetooth: 'prompt',
      location: 'prompt',
    });
    await expect(mod.checkScanPrerequisites()).rejects.toMatchObject({
      code: 'PM5_PERMISSION_DENIED',
    });
  });

  it('turns any other plugin rejection into PM5_SCAN_FAILED', async () => {
    ble.plugin.isEnabled.mockRejectedValue(new Error('bridge gone'));
    await expect(mod.checkScanPrerequisites()).rejects.toMatchObject({
      code: 'PM5_SCAN_FAILED',
    });
  });
});

describe('startPM5Scan', () => {
  it('listens, stops any old scan, then starts one filtered on the PM5 UUID with no timeout', async () => {
    await mod.startPM5Scan(() => {});
    expect(ble.calls).toEqual([
      'addListener:deviceScanned',
      'stopScan',
      'startScan',
    ]);
    expect(ble.plugin.startScan).toHaveBeenCalledWith({
      services: [PM5_DEVICE],
      allowDuplicates: true,
    });
  });

  it('passes each result on as {deviceId, name} and drops one with no id', async () => {
    const onSighting = vi.fn();
    await mod.startPM5Scan(onSighting);
    emit('deviceScanned', { device: { deviceId: 'AA', name: 'PM5 1 Row' } });
    emit('deviceScanned', { device: { deviceId: 'BB' } });
    emit('deviceScanned', { device: { name: 'no id' } });
    emit('deviceScanned', {});
    expect(onSighting.mock.calls).toEqual([
      [{ deviceId: 'AA', name: 'PM5 1 Row' }],
      [{ deviceId: 'BB', name: null }],
    ]);
  });

  it('stop is idempotent, removes the listener and ignores later results', async () => {
    const onSighting = vi.fn();
    const stop = await mod.startPM5Scan(onSighting);
    const [listener] = live('deviceScanned');
    await stop();
    await stop();
    expect(listener.remove).toHaveBeenCalledTimes(1);
    // One stopScan before starting, one from stop().
    expect(ble.plugin.stopScan).toHaveBeenCalledTimes(2);
    listener.fn({ device: { deviceId: 'AA', name: 'PM5 1 Row' } });
    expect(onSighting).not.toHaveBeenCalled();
  });

  it('reports a stopScan failure during stop', async () => {
    const stop = await mod.startPM5Scan(() => {});
    ble.plugin.stopScan.mockRejectedValue(new Error('scanner gone'));
    await stop();
    expect(sentry.captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Scan',
      step: 'stop',
    });
  });

  it('maps the plugin permission rejection to PM5_PERMISSION_DENIED and stops listening', async () => {
    ble.plugin.startScan.mockRejectedValue(
      new Error('Required permissions not granted')
    );
    await expect(mod.startPM5Scan(() => {})).rejects.toMatchObject({
      code: 'PM5_PERMISSION_DENIED',
    });
    expect(live('deviceScanned')).toHaveLength(0);
  });

  it('maps any other start failure to PM5_SCAN_FAILED', async () => {
    ble.plugin.startScan.mockRejectedValue(
      new Error('Bluetooth scanner not available')
    );
    await expect(mod.startPM5Scan(() => {})).rejects.toMatchObject({
      code: 'PM5_SCAN_FAILED',
    });
    expect(live('deviceScanned')).toHaveLength(0);
  });

  it('delays a fifth start within 30 s until a slot frees', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < mod.PM5_SCAN_START_LIMIT; i += 1) {
      await mod.startPM5Scan(() => {});
    }
    expect(ble.plugin.startScan).toHaveBeenCalledTimes(4);

    let started = false;
    const fifth = mod
      .startPM5Scan(() => {})
      .then(() => {
        started = true;
      });
    await vi.advanceTimersByTimeAsync(mod.PM5_SCAN_START_PERIOD_MS - 1);
    expect(started).toBe(false);
    expect(ble.plugin.startScan).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    await fifth;
    expect(ble.plugin.startScan).toHaveBeenCalledTimes(5);
  });

  it('an abort while waiting for a slot clears the wait and never starts', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < mod.PM5_SCAN_START_LIMIT; i += 1) {
      await mod.startPM5Scan(() => {});
    }
    const abort = new window.AbortController();
    const pending = mod.startPM5Scan(() => {}, { signal: abort.signal });
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBe(1);
    abort.abort();
    const stop = await pending;
    expect(vi.getTimerCount()).toBe(0);
    expect(ble.plugin.startScan).toHaveBeenCalledTimes(4);
    expect(live('deviceScanned')).toHaveLength(4);
    await stop();
  });
});

describe('connectToChosenPM5', () => {
  let original;

  function makeDevice(id, { serviceFails = false } = {}) {
    const service = {
      getCharacteristic: vi.fn((uuid) => Promise.resolve({ uuid })),
    };
    return {
      id,
      gatt: {
        connected: true,
        connect: vi.fn(),
        disconnect: vi.fn(),
        getPrimaryService: serviceFails
          ? vi.fn().mockRejectedValue(new Error('NotFoundError'))
          : vi.fn().mockResolvedValue(service),
      },
    };
  }

  function installDevices(devices) {
    Object.defineProperty(navigator, 'bluetooth', {
      value: { getDevices: vi.fn().mockResolvedValue(devices) },
      configurable: true,
    });
  }

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(navigator, 'bluetooth');
  });

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'bluetooth', original);
    else delete navigator.bluetooth;
  });

  // AC2, AC3: only the chosen id is connected, and the right device is used.
  it('connects only the chosen id and opens that device without gatt.connect', async () => {
    const a = makeDevice('AA');
    const b = makeDevice('BB');
    const c = makeDevice('CC');
    installDevices([a, b, c]);
    const result = await mod.connectToChosenPM5('BB');
    expect(ble.plugin.connect).toHaveBeenCalledTimes(1);
    expect(ble.plugin.connect).toHaveBeenCalledWith({ deviceId: 'BB' });
    expect(result.device).toBe(b);
    expect(b.gatt.getPrimaryService).toHaveBeenCalledWith(ROW_SERVICE);
    expect(result.chars.generalStatus).toEqual({
      uuid: 'ce060031-43e5-11e4-916c-0800200c9a66',
    });
    for (const d of [a, b, c]) expect(d.gatt.connect).not.toHaveBeenCalled();
    expect(a.gatt.getPrimaryService).not.toHaveBeenCalled();
    expect(ble.plugin.disconnect).not.toHaveBeenCalled();
    expect(live('deviceDisconnected')).toHaveLength(0);
  });

  it('times out, disconnects and reports once when the plugin never answers', async () => {
    vi.useFakeTimers();
    installDevices([makeDevice('BB')]);
    ble.plugin.connect.mockReturnValue(new Promise(() => {}));
    let settled = null;
    const attempt = mod.connectToChosenPM5('BB').catch((err) => {
      settled = err;
    });
    await vi.advanceTimersByTimeAsync(mod.PM5_CONNECT_TIMEOUT_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await attempt;
    expect(settled).toMatchObject({ code: 'PM5_CONNECT_FAILED' });
    expect(settled.cause.message).toMatch(/timed out/);
    expect(ble.plugin.disconnect).toHaveBeenCalledWith({ deviceId: 'BB' });
    expect(sentry.captureError).toHaveBeenCalledTimes(1);
    expect(sentry.captureError).toHaveBeenCalledWith(expect.any(Error), {
      source: 'pm5Scan',
    });
    expect(live('deviceDisconnected')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails at once when the chosen PM5 disconnects while connecting', async () => {
    installDevices([makeDevice('BB')]);
    ble.plugin.connect.mockReturnValue(new Promise(() => {}));
    const attempt = mod.connectToChosenPM5('BB');
    await vi.waitFor(() => expect(live('deviceDisconnected')).toHaveLength(1));
    emit('deviceDisconnected', { deviceId: 'BB' });
    await expect(attempt).rejects.toMatchObject({ code: 'PM5_CONNECT_FAILED' });
    expect(ble.plugin.disconnect).toHaveBeenCalledWith({ deviceId: 'BB' });
  });

  it('ignores a disconnect for another monitor', async () => {
    const b = makeDevice('BB');
    installDevices([b]);
    let resolveConnect;
    ble.plugin.connect.mockReturnValue(
      new Promise((resolve) => {
        resolveConnect = resolve;
      })
    );
    const attempt = mod.connectToChosenPM5('BB');
    await vi.waitFor(() => expect(live('deviceDisconnected')).toHaveLength(1));
    emit('deviceDisconnected', { deviceId: 'AA' });
    resolveConnect();
    await expect(attempt).resolves.toMatchObject({ device: b });
  });

  it('fails when the chosen id is missing from getDevices', async () => {
    installDevices([makeDevice('AA')]);
    await expect(mod.connectToChosenPM5('BB')).rejects.toMatchObject({
      code: 'PM5_CONNECT_FAILED',
    });
    expect(ble.plugin.disconnect).toHaveBeenCalledWith({ deviceId: 'BB' });
  });

  it('fails and closes the link when the rowing service is missing', async () => {
    const b = makeDevice('BB', { serviceFails: true });
    installDevices([b]);
    await expect(mod.connectToChosenPM5('BB')).rejects.toMatchObject({
      code: 'PM5_CONNECT_FAILED',
    });
    expect(b.gatt.disconnect).toHaveBeenCalled();
    expect(ble.plugin.disconnect).toHaveBeenCalledWith({ deviceId: 'BB' });
  });

  it('fails when the plugin rejects the connect', async () => {
    installDevices([makeDevice('BB')]);
    ble.plugin.connect.mockRejectedValue(new Error('Device not found'));
    await expect(mod.connectToChosenPM5('BB')).rejects.toMatchObject({
      code: 'PM5_CONNECT_FAILED',
    });
  });

  it('an abort ends the attempt, disconnects and is not reported', async () => {
    installDevices([makeDevice('BB')]);
    ble.plugin.connect.mockReturnValue(new Promise(() => {}));
    const abort = new window.AbortController();
    const attempt = mod.connectToChosenPM5('BB', { signal: abort.signal });
    await vi.waitFor(() => expect(ble.plugin.connect).toHaveBeenCalled());
    abort.abort();
    await expect(attempt).rejects.toMatchObject({ name: 'AbortError' });
    expect(ble.plugin.disconnect).toHaveBeenCalledWith({ deviceId: 'BB' });
    expect(sentry.captureError).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(live('deviceDisconnected')).toHaveLength(0));
  });
});
