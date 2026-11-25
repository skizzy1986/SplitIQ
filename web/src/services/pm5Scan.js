// Native (Android) PM5 discovery: scan for monitors in range so the user can
// pick theirs from a list, then connect to that one by id. The browser keeps
// its own chooser (connectToPM5 in pm5Bluetooth.js).
//
// Plugin behaviour this file works around, from BluetoothLowEnergyPlugin.java
// in @capgo/capacitor-bluetooth-low-energy 8.2.9:
// - connect() resolves only when the link comes up and never rejects when it
//   fails, so the connect needs its own timeout and a deviceDisconnected
//   listener.
// - startScan's `timeout` timer is never cancelled and would stop a later
//   scan, so no timeout is passed; the caller stops the scan itself.
// - The plugin holds one scan callback, so a scan is stopped before starting.
//
// The plugin is imported statically: main.jsx already imports it for the Web
// Bluetooth shim, so it is in the entry chunk either way. The connect route
// reads navigator.bluetooth.getDevices(), which exists only because main.jsx
// installs that shim at boot (utils/nativeBluetooth.js, #766).
import { BluetoothLowEnergy } from '@capgo/capacitor-bluetooth-low-energy';
import { PM5_DEVICE, openPM5, disconnectPM5 } from './pm5Bluetooth.js';
import { captureError } from '../utils/sentry.js';

// A row not seen for this long leaves the list; the sweep runs this often.
export const PM5_STALE_MS = 5000;
export const PM5_SWEEP_MS = 1000;
// With no rows for this long the scan stops and the list says none was found.
export const PM5_EMPTY_AFTER_MS = 10000;
export const PM5_CONNECT_TIMEOUT_MS = 10000;
// Android throttles an app to about five scan starts per 30 s and then
// silently returns nothing, so starts past this limit wait for a slot.
export const PM5_SCAN_START_LIMIT = 4;
export const PM5_SCAN_START_PERIOD_MS = 30000;

// Error codes this module throws, mapped to on-screen words in
// constants/pm5ErrorMessages.js.
export const PM5_BLE_UNAVAILABLE = 'PM5_BLE_UNAVAILABLE';
export const PM5_SCAN_FAILED = 'PM5_SCAN_FAILED';
export const PM5_BLUETOOTH_OFF = 'PM5_BLUETOOTH_OFF';
export const PM5_PERMISSION_DENIED = 'PM5_PERMISSION_DENIED';
export const PM5_CONNECT_FAILED = 'PM5_CONNECT_FAILED';

function codedError(code, message, cause) {
  const err = new Error(message, cause ? { cause } : undefined);
  err.code = code;
  return err;
}

// Throws one of the codes above, or resolves with whether Location is off.
// Location off never blocks: Android 12 and newer scan without it.
export async function checkScanPrerequisites() {
  try {
    const { available } = await BluetoothLowEnergy.isAvailable();
    if (!available) {
      throw codedError(
        PM5_BLE_UNAVAILABLE,
        'Bluetooth Low Energy is not available on this device.'
      );
    }
    // Every scan: the plugin takes its scanner here, and it has none if
    // Bluetooth was off the last time this ran.
    try {
      await BluetoothLowEnergy.initialize({ mode: 'central' });
    } catch (err) {
      throw codedError(PM5_SCAN_FAILED, 'Bluetooth initialize failed.', err);
    }
    const { enabled } = await BluetoothLowEnergy.isEnabled();
    if (!enabled) {
      throw codedError(PM5_BLUETOOTH_OFF, 'Bluetooth is off.');
    }
    // Android reports only 'granted' or 'prompt', never 'denied'.
    const permissions = await BluetoothLowEnergy.requestPermissions();
    if (permissions?.bluetooth !== 'granted') {
      throw codedError(
        PM5_PERMISSION_DENIED,
        'Bluetooth permission not granted.'
      );
    }
    const location = await BluetoothLowEnergy.isLocationEnabled();
    return { locationOff: location?.enabled === false };
  } catch (err) {
    if (typeof err?.code === 'string' && err.code.startsWith('PM5_')) {
      throw err;
    }
    throw codedError(PM5_SCAN_FAILED, 'Bluetooth check failed.', err);
  }
}

// Start times of recent scans, shared by every caller in this app session.
let scanStarts = [];

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done);
  });
}

async function waitForScanSlot(signal) {
  for (;;) {
    if (signal?.aborted) return;
    const now = Date.now();
    scanStarts = scanStarts.filter((t) => now - t < PM5_SCAN_START_PERIOD_MS);
    if (scanStarts.length < PM5_SCAN_START_LIMIT) {
      scanStarts.push(now);
      return;
    }
    await sleep(scanStarts[0] + PM5_SCAN_START_PERIOD_MS - now, signal);
  }
}

// Scan for PM5s, calling onSighting({deviceId, name}) for every result, many
// times a second per monitor. Resolves with an idempotent stop(). Aborting
// `signal` before the scan starts cleans up and resolves with a stop() that
// has already run, so nothing is left listening or waiting.
export async function startPM5Scan(onSighting, { signal } = {}) {
  let stopped = false;
  let handle = null;
  let stopping = null;
  const stop = () => {
    if (!stopping) {
      stopped = true;
      stopping = Promise.all([
        handle?.remove(),
        BluetoothLowEnergy.stopScan(),
      ]).then(
        () => undefined,
        (err) => captureError(err, { source: 'pm5Scan', step: 'stop' })
      );
    }
    return stopping;
  };

  try {
    // Listen before the scan starts so no early result is lost.
    handle = await BluetoothLowEnergy.addListener('deviceScanned', (event) => {
      const device = event?.device;
      if (stopped || !device?.deviceId) return;
      onSighting({ deviceId: device.deviceId, name: device.name ?? null });
    });
    await BluetoothLowEnergy.stopScan();
    await waitForScanSlot(signal);
    if (signal?.aborted) {
      stop();
      return stop;
    }
    await BluetoothLowEnergy.startScan({
      services: [PM5_DEVICE],
      allowDuplicates: true,
    });
  } catch (err) {
    stopped = true;
    // The start already failed; a failed removal is reported, not thrown.
    Promise.resolve(handle?.remove()).catch((removeErr) =>
      captureError(removeErr, { source: 'pm5Scan', step: 'listener' })
    );
    // The plugin rejects "Required permissions not granted", or "Permission
    // denied: ..." from a SecurityException.
    if (/permission/i.test(err?.message ?? '')) {
      throw codedError(
        PM5_PERMISSION_DENIED,
        'Bluetooth permission not granted.',
        err
      );
    }
    throw codedError(PM5_SCAN_FAILED, 'PM5 scan failed to start.', err);
  }
  return stop;
}

// Connect to the PM5 the user chose, and only that one. Resolves with what
// openPM5 returns; throws PM5_CONNECT_FAILED with the reason as `cause`.
// Aborting `signal` ends the attempt at once, disconnects, and throws the
// abort without reporting it.
export async function connectToChosenPM5(deviceId, { signal } = {}) {
  let fail;
  const failure = new Promise((_, reject) => {
    fail = reject;
  });
  // Only ever raced below; this keeps a rejection that lands between races
  // from being reported as unhandled.
  failure.catch(() => {});
  const timer = setTimeout(
    () =>
      fail(
        new Error(`PM5 connect timed out after ${PM5_CONNECT_TIMEOUT_MS} ms`)
      ),
    PM5_CONNECT_TIMEOUT_MS
  );
  const onAbort = () => {
    const err = new Error('PM5 connect aborted');
    err.name = 'AbortError';
    fail(err);
  };
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) onAbort();
  const listening = BluetoothLowEnergy.addListener(
    'deviceDisconnected',
    (event) => {
      if (event?.deviceId === deviceId) {
        fail(new Error('PM5 disconnected while connecting'));
      }
    }
  );
  let device = null;
  try {
    await Promise.race([listening, failure]);
    await Promise.race([BluetoothLowEnergy.connect({ deviceId }), failure]);
    // The shim's getDevices wraps the plugin's open link, marked connected.
    const devices = await Promise.race([
      navigator.bluetooth.getDevices(),
      failure,
    ]);
    device = devices.find((d) => d.id === deviceId) ?? null;
    if (!device) throw new Error('Chosen PM5 missing from getDevices');
    // device.gatt is the server: gatt.connect() would open a second GATT
    // client that replaces the first.
    return await Promise.race([openPM5(device, device.gatt), failure]);
  } catch (cause) {
    if (device) disconnectPM5(device);
    BluetoothLowEnergy.disconnect({ deviceId }).catch((err) =>
      captureError(err, { source: 'pm5Scan', step: 'disconnect' })
    );
    if (signal?.aborted) throw cause;
    captureError(cause, { source: 'pm5Scan' });
    throw codedError(
      PM5_CONNECT_FAILED,
      'Could not connect to the PM5.',
      cause
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    // Through the promise, so a listener that registers after a lost race is
    // still removed.
    listening
      .then((handle) => handle.remove())
      .catch((err) =>
        captureError(err, { source: 'pm5Scan', step: 'listener' })
      );
  }
}
