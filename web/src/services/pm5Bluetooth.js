// Concept2 PM5 BLE GATT service and characteristic UUIDs and packet layouts.
// Source: ergometerjs (github.com/tijmenvangulik/ergometerjs),
// api/typescript/ergometer/ble/typedefinitions.ts. All multi-byte fields are
// little-endian.
import { pace500ToWatts } from '../utils/pace.js';
import { captureError } from '../utils/sentry.js';

const PM5_ROW_SERVICE = 'ce060030-43e5-11e4-916c-0800200c9a66';
const ROWING_GENERAL_STATUS = 'ce060031-43e5-11e4-916c-0800200c9a66';
const ROWING_ADDITIONAL_STATUS_1 = 'ce060032-43e5-11e4-916c-0800200c9a66';
const ROWING_ADDITIONAL_STATUS_2 = 'ce060033-43e5-11e4-916c-0800200c9a66';
const ROWING_SUMMARY = 'ce060039-43e5-11e4-916c-0800200c9a66';

// Error codes this module throws, mapped to on-screen words in
// constants/pm5ErrorMessages.js.
export const PM5_UNSUPPORTED = 'PM5_UNSUPPORTED';

// Workout state, byte 8 of the 0031 general status packet.
export const PM5WorkoutState = Object.freeze({
  waitToBegin: 0,
  workoutRow: 1,
  countDownPause: 2,
  intervalRest: 3,
  intervalWorktime: 4,
  intervalWorkDistance: 5,
  intervalRestEndToWorkTime: 6,
  intervalRestEndToWorkDistance: 7,
  intervalWorktimeToRest: 8,
  intervalWorkDistanceToRest: 9,
  workoutEnd: 10,
  terminate: 11,
  workoutLogged: 12,
  rearm: 13,
});

const WORKING_STATES = new Set([1, 4, 5]);
const REST_STATES = new Set([3, 6, 7, 8, 9]);
const END_STATES = new Set([10, 11, 12]);

export function isWorkingState(state) {
  return WORKING_STATES.has(state);
}

export function isRestState(state) {
  return REST_STATES.has(state);
}

export function isEndState(state) {
  return END_STATES.has(state);
}

// 0032/0033 arrive on their own notifications, so a value is only merged into
// a 0031 sample when its own elapsed clock is this close to 0031's.
export const STALE_LIMIT_S = 1.0;

// Convert 500m split time (raw 0.01s units) to "m:ss.t" string
export function parsePace(rawValue) {
  if (!rawValue || rawValue === 0) return '--:--';
  const totalSecs = rawValue / 100;
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// Format elapsed seconds as "mm:ss"
export function formatElapsed(totalSecs) {
  const m = Math.floor(totalSecs / 60);
  const s = Math.floor(totalSecs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function uint24(dv, offset) {
  return (
    dv.getUint8(offset) |
    (dv.getUint8(offset + 1) << 8) |
    (dv.getUint8(offset + 2) << 16)
  );
}

// A short packet returns null rather than throwing a RangeError inside a
// notification listener.
function tooShort(dv, minBytes) {
  return !dv || dv.byteLength < minBytes;
}

// 0031 general status
export function parseGeneralStatus(dv) {
  if (tooShort(dv, 10)) return null;
  return {
    elapsedTime: uint24(dv, 0) / 100,
    distance: uint24(dv, 3) / 10,
    workoutType: dv.getUint8(6),
    workoutState: dv.getUint8(8),
    rowingState: dv.getUint8(9),
  };
}

// 0032 additional status 1 (byte 6 heart rate is deliberately ignored, #651)
export function parseAdditionalStatus1(dv) {
  if (tooShort(dv, 11)) return null;
  return {
    elapsedTime: uint24(dv, 0) / 100,
    strokeRate: dv.getUint8(5),
    currentPace: dv.getUint16(7, true),
    averagePace: dv.getUint16(9, true),
  };
}

// 0033 additional status 2
export function parseAdditionalStatus2(dv) {
  if (tooShort(dv, 8)) return null;
  return {
    elapsedTime: uint24(dv, 0) / 100,
    averagePower: dv.getUint16(4, true),
    totalCalories: dv.getUint16(6, true),
  };
}

// 0039 rowing summary. Bytes 18-19 carry average pace in 0.1s units, not the
// 0.01s used everywhere else, so they are not read.
export function parseRowingSummary(dv) {
  if (tooShort(dv, 11)) return null;
  return {
    elapsedTime: uint24(dv, 4) / 100,
    distance: uint24(dv, 7) / 10,
    avgSpm: dv.getUint8(10),
    workoutType: dv.byteLength >= 18 ? dv.getUint8(17) : null,
  };
}

function isFresh(part, general) {
  return (
    part != null &&
    Math.abs(part.elapsedTime - general.elapsedTime) <= STALE_LIMIT_S
  );
}

// One live sample per 0031 packet. Fields from a missing or stale 0032/0033
// are null, never 0, so "not measured" stays distinguishable from a real 0.
export function mergeStatus(general, add1, add2) {
  const a1 = isFresh(add1, general) ? add1 : null;
  const a2 = isFresh(add2, general) ? add2 : null;
  const pace500 = a1 ? a1.currentPace : null;
  return {
    elapsedTime: general.elapsedTime,
    elapsedStr: formatElapsed(general.elapsedTime),
    distance: general.distance,
    workoutState: general.workoutState,
    rowingState: general.rowingState,
    strokeRate: a1 ? a1.strokeRate : null,
    pace500,
    paceStr: parsePace(pace500),
    // pace500ToWatts(0) is Infinity, so a zero pace has no watts.
    watts: pace500 > 0 ? Math.round(pace500ToWatts(pace500 / 100)) : null,
    calories: a2 ? a2.totalCalories : null,
  };
}

function roundedMean(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((a, v) => a + v, 0) / values.length);
}

// The summary's 0032/0033 figures must come from this close to the end of the
// piece; anything older belongs to an earlier part of the session.
export const SUMMARY_STALE_LIMIT_S = 10;

// A 0039 arriving after the summary is built only refines it when it ends no
// earlier than this before the piece did; otherwise it is the next piece's.
export const REFINE_MARGIN_S = 2;

// The later of the last pushed sample and the last packet seen. A PM5 that
// drops to waitToBegin or rearm zeroes its counters, and that packet must not
// replace the piece that was rowed.
export function summaryReference(samples, lastSample) {
  const pushed = samples.length ? samples[samples.length - 1] : null;
  if (!pushed) return lastSample;
  if (!lastSample) return pushed;
  return lastSample.elapsedTime >= pushed.elapsedTime ? lastSample : pushed;
}

// Summary keys are unchanged from the original hook; each prefers the PM5's own
// figure and falls back to the live samples.
export function buildPM5Summary({
  samples = [],
  lastSample = null,
  add1 = null,
  add2 = null,
  rowSummary = null,
  maxWatts = 0,
}) {
  const ref = summaryReference(samples, lastSample);
  const nearEnd = (part) =>
    part != null &&
    ref != null &&
    Math.abs(part.elapsedTime - ref.elapsedTime) <= SUMMARY_STALE_LIMIT_S;
  const a1 = nearEnd(add1) ? add1 : null;
  const a2 = nearEnd(add2) ? add2 : null;

  let distance = 0;
  let elapsedTime = 0;
  if (rowSummary) {
    distance = Math.round(rowSummary.distance);
    elapsedTime = rowSummary.elapsedTime;
  } else if (ref) {
    distance = Math.round(ref.distance);
    elapsedTime = ref.elapsedTime;
  }

  const avgPace =
    a1?.averagePace > 0
      ? a1.averagePace
      : roundedMean(
          samples.map((s) => s.pace500).filter((p) => p != null && p > 0)
        );

  let avgWatts;
  if (a2?.averagePower > 0) avgWatts = a2.averagePower;
  else if (avgPace > 0) avgWatts = Math.round(pace500ToWatts(avgPace / 100));
  else
    avgWatts = roundedMean(
      samples.map((s) => s.watts).filter((w) => w != null)
    );

  const avgSpm =
    rowSummary?.avgSpm > 0
      ? rowSummary.avgSpm
      : roundedMean(samples.map((s) => s.strokeRate).filter((r) => r != null));

  return {
    distance,
    elapsedTime,
    elapsedStr: formatElapsed(elapsedTime),
    avgWatts,
    avgPace,
    avgSpm,
    maxWatts: maxWatts || 0,
    calories: a2?.totalCalories ?? 0,
  };
}

// Request connection to a PM5 device via Web Bluetooth.
// 0031 is required; 0032, 0033 and 0039 are optional and come back null when
// the characteristic cannot be fetched, with the rejection kept in `errors`.
export async function connectToPM5() {
  if (!navigator.bluetooth) {
    // The English message is for logs and Sentry; the screen reads `code`.
    const err = new Error(
      'Web Bluetooth is not supported in this browser. Use Chrome or Edge.'
    );
    err.code = PM5_UNSUPPORTED;
    throw err;
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [PM5_ROW_SERVICE] }],
    optionalServices: [PM5_ROW_SERVICE],
  });

  const server = await device.gatt.connect();
  let service;
  let generalStatus;
  try {
    service = await server.getPrimaryService(PM5_ROW_SERVICE);
    generalStatus = await service.getCharacteristic(ROWING_GENERAL_STATUS);
  } catch (err) {
    // The caller never receives the device, so close the link here.
    disconnectPM5(device);
    throw err;
  }
  const [add1, add2, summary] = await Promise.allSettled([
    service.getCharacteristic(ROWING_ADDITIONAL_STATUS_1),
    service.getCharacteristic(ROWING_ADDITIONAL_STATUS_2),
    service.getCharacteristic(ROWING_SUMMARY),
  ]);
  const value = (r) => (r.status === 'fulfilled' ? r.value : null);
  const reason = (r) => (r.status === 'rejected' ? r.reason : null);

  return {
    device,
    chars: {
      generalStatus,
      additionalStatus1: value(add1),
      additionalStatus2: value(add2),
      workoutSummary: value(summary),
    },
    errors: {
      additionalStatus1: reason(add1),
      additionalStatus2: reason(add2),
      workoutSummary: reason(summary),
    },
  };
}

// Hand each parsed packet to callback. A packet the parser rejects is dropped;
// it is reported once per subscription so a PM5 sending short packets every
// 500 ms does not flood Sentry.
export async function subscribe(characteristic, parser, callback) {
  let reported = false;
  const onValue = (e) => {
    const value = e.target.value;
    const parsed = parser(value);
    if (parsed === null) {
      if (!reported) {
        reported = true;
        captureError(new Error('PM5 notification too short to parse'), {
          source: 'pm5Bluetooth',
          char: characteristic.uuid,
          byteLength: value?.byteLength,
        });
      }
      return;
    }
    callback(parsed);
  };
  // Listen before starting notifications so a packet sent in between is kept.
  characteristic.addEventListener('characteristicvaluechanged', onValue);
  try {
    await characteristic.startNotifications();
  } catch (err) {
    characteristic.removeEventListener('characteristicvaluechanged', onValue);
    throw err;
  }
}

export async function disconnectPM5(device) {
  if (device && device.gatt.connected) {
    device.gatt.disconnect();
  }
}
