import { useState, useRef, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  connectToPM5,
  subscribe,
  disconnectPM5,
  parseGeneralStatus,
  parseAdditionalStatus1,
  parseAdditionalStatus2,
  parseRowingSummary,
  mergeStatus,
  buildPM5Summary,
  summaryReference,
  REFINE_MARGIN_S,
  isWorkingState,
  isEndState,
} from '../services/pm5Bluetooth';
import {
  checkScanPrerequisites,
  startPM5Scan,
  connectToChosenPM5,
  PM5_STALE_MS,
  PM5_SWEEP_MS,
  PM5_EMPTY_AFTER_MS,
  PM5_CONNECT_FAILED,
} from '../services/pm5Scan';
import { upsertMonitor, expireMonitors } from '../utils/pm5Monitors';
import { readLastPm5Id, writeLastPm5Id } from '../utils/pm5LastUsed.js';
import { captureError } from '../utils/sentry.js';

function freshPiece() {
  return {
    samples: [],
    maxWatts: 0,
    lastSample: null,
    add1: null,
    add2: null,
    rowSummary: null,
    sawWork: false,
    summaryBuilt: false,
  };
}

// A missing or failed optional characteristic costs only its fields; the
// piece still records from 0031.
async function subscribeOptional(
  characteristic,
  fetchError,
  parser,
  callback,
  char
) {
  if (!characteristic) {
    captureError(
      fetchError ?? new Error(`PM5 characteristic ${char} unavailable`),
      { source: 'pm5Bluetooth', char }
    );
    return;
  }
  try {
    await subscribe(characteristic, parser, callback);
  } catch (err) {
    captureError(err, { source: 'pm5Bluetooth', char });
  }
}

export function usePM5() {
  const [status, setStatus] = useState('idle');
  // idle | choosing | connecting | connected | rowing | finished | error
  // `choosing` is the native PM5 list; the browser shows its own chooser.
  const [metrics, setMetrics] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  // Set only for errors pm5Bluetooth.js throws with a string code; a browser
  // DOMException's numeric legacy `code` is not one of ours.
  const [errorCode, setErrorCode] = useState(null);
  const [monitors, setMonitors] = useState([]);
  const [scanPhase, setScanPhase] = useState('searching');
  const [connectingId, setConnectingId] = useState(null);
  const [locationOff, setLocationOff] = useState(false);

  const deviceRef = useRef(null);
  // Notification callbacks are created once per connect, so everything they
  // read lives in this ref; React state inside them would be a stale closure.
  const pieceRef = useRef(freshPiece());

  // The native list. Scan results arrive many times a second per PM5, so the
  // rows live in a ref and `monitors` is set only when the screen changes.
  const rowsRef = useRef([]);
  // The running scan: {stop, abort, sweep, emptySince}, or null.
  const scanRef = useRef(null);
  const connectAbortRef = useRef(null);
  const connectingRef = useRef(null);
  const choosingRef = useRef(false);
  // Last-used auto-choose (#771): one attempt per Start, never a loop.
  const autoTriedRef = useRef(false);
  const autoSkipRef = useRef(null);
  const autoConnectingRef = useRef(false);
  const chooseRef = useRef(null);
  // Bumped by every scan start, cancel, pause and unmount. An await that
  // returns to an older number belongs to a list that has gone.
  const genRef = useRef(0);
  // One per connect attempt. A disconnect event or notification from an
  // attempt that is no longer current does nothing: the shim reuses one
  // device object per id, so an earlier attempt's listener is still on it.
  // In the browser it changes only when connect() starts a new attempt.
  const attemptRef = useRef(0);

  const publishRows = useCallback((list) => {
    rowsRef.current = list;
    setMonitors(list.map(({ id, name, stale }) => ({ id, name, stale })));
  }, []);

  // If the remembered PM5 is live in this scan, choose it once. Skipped when
  // nothing is remembered, when that id failed earlier in this Start, or
  // when a connect is already in flight.
  const maybeAutoChoose = useCallback((list) => {
    if (autoTriedRef.current || autoConnectingRef.current) return;
    if (connectingRef.current || !choosingRef.current) return;
    const want = readLastPm5Id();
    if (!want || want === autoSkipRef.current) return;
    if (!list.some((m) => m.id === want && !m.stale)) return;
    autoTriedRef.current = true;
    autoConnectingRef.current = true;
    chooseRef.current?.(want);
  }, []);

  const stopScanning = useCallback(() => {
    const scan = scanRef.current;
    if (!scan) return;
    scanRef.current = null;
    scan.abort.abort();
    clearInterval(scan.sweep);
    scan.stop?.();
  }, []);

  // Cancel and pause: back to the Connect screen with nothing connected.
  const leaveList = useCallback(() => {
    genRef.current += 1;
    attemptRef.current += 1;
    stopScanning();
    connectAbortRef.current?.abort();
    connectAbortRef.current = null;
    connectingRef.current = null;
    choosingRef.current = false;
    rowsRef.current = [];
    setMonitors([]);
    setConnectingId(null);
    setError(null);
    setErrorCode(null);
    setStatus('idle');
  }, [stopScanning]);

  const failList = useCallback(
    (err) => {
      stopScanning();
      choosingRef.current = false;
      rowsRef.current = [];
      setMonitors([]);
      setConnectingId(null);
      setError(err.message);
      setErrorCode(typeof err.code === 'string' ? err.code : null);
      setStatus('error');
    },
    [stopScanning]
  );

  // Start, or restart, the scan behind the list. Rows already listed stay.
  const beginScan = useCallback(async () => {
    genRef.current += 1;
    const gen = genRef.current;
    stopScanning();
    choosingRef.current = true;
    autoTriedRef.current = false;
    autoConnectingRef.current = false;
    setStatus('choosing');
    setScanPhase('searching');

    let prerequisites;
    try {
      prerequisites = await checkScanPrerequisites();
    } catch (err) {
      if (gen === genRef.current) failList(err);
      return;
    }
    if (gen !== genRef.current) return;
    setLocationOff(prerequisites.locationOff);

    const scan = {
      stop: null,
      abort: new window.AbortController(),
      sweep: null,
      emptySince: null,
    };
    scanRef.current = scan;
    const onSighting = (sighting) => {
      if (scanRef.current !== scan) return;
      const { list, changed } = upsertMonitor(
        rowsRef.current,
        sighting,
        Date.now()
      );
      if (changed) publishRows(list);
      else rowsRef.current = list;
      maybeAutoChoose(list);
    };

    let stop;
    try {
      stop = await startPM5Scan(onSighting, { signal: scan.abort.signal });
    } catch (err) {
      if (gen === genRef.current) failList(err);
      return;
    }
    if (gen !== genRef.current || scanRef.current !== scan) {
      stop();
      return;
    }
    scan.stop = stop;
    // Rows kept from before a restart get a fresh window to be seen again.
    const started = Date.now();
    rowsRef.current = rowsRef.current.map((m) => ({ ...m, lastSeen: started }));
    const hasLive = (list) => list.some((m) => !m.stale);
    scan.emptySince = hasLive(rowsRef.current) ? null : started;
    scan.sweep = setInterval(() => {
      const now = Date.now();
      const { list, changed } = expireMonitors(
        rowsRef.current,
        now,
        PM5_STALE_MS
      );
      if (changed) publishRows(list);
      maybeAutoChoose(list);
      // "None found" counts only monitors still in range.
      if (hasLive(list)) {
        scan.emptySince = null;
      } else if (scan.emptySince == null) {
        scan.emptySince = now;
      } else if (now - scan.emptySince >= PM5_EMPTY_AFTER_MS) {
        stopScanning();
        setScanPhase('empty');
      }
    }, PM5_SWEEP_MS);
  }, [stopScanning, failList, publishRows, maybeAutoChoose]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const initBle = async () => {
      try {
        const { BluetoothLowEnergy } =
          await import('@capgo/capacitor-bluetooth-low-energy');
        await BluetoothLowEnergy.requestPermissions();
      } catch (err) {
        setError(err.message);
      }
    };
    initBle();
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = App.addListener('pause', () => {
      if (deviceRef.current?.gatt?.connected) {
        attemptRef.current += 1;
        disconnectPM5(deviceRef.current);
        deviceRef.current = null;
        setStatus('idle');
        setMetrics(null);
      }
      if (choosingRef.current) leaveList();
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, [leaveList]);

  useEffect(
    () => () => {
      genRef.current += 1;
      attemptRef.current += 1;
      stopScanning();
      connectAbortRef.current?.abort();
    },
    [stopScanning]
  );

  const finishPiece = useCallback(() => {
    const piece = pieceRef.current;
    if (piece.summaryBuilt) return;
    piece.summaryBuilt = true;
    setSummary(buildPM5Summary(piece));
    setStatus('finished');
  }, []);

  // Subscribe to a connected PM5 for a fresh piece. Throws when 0031 cannot
  // be subscribed; the caller closes the link. Every callback belongs to
  // `attempt` and does nothing once another attempt has started.
  const startPiece = useCallback(
    async ({ device, chars, errors = {} }, attempt) => {
      pieceRef.current = freshPiece();
      const current = (fn) => (value) => {
        if (attemptRef.current === attempt) fn(value);
      };

      const onGeneralStatus = current((general) => {
        const piece = pieceRef.current;
        const sample = mergeStatus(general, piece.add1, piece.add2);
        setMetrics(sample);
        // Frozen once built, so a later 0039 is judged against the piece that ended.
        if (piece.summaryBuilt) return;
        piece.lastSample = sample;

        if (isWorkingState(sample.workoutState)) {
          piece.sawWork = true;
          if (sample.rowingState === 1) {
            piece.samples.push(sample);
            if (sample.watts != null && sample.watts > piece.maxWatts) {
              piece.maxWatts = sample.watts;
            }
            setStatus('rowing');
          } else {
            setStatus('connected');
          }
        } else if (isEndState(sample.workoutState) && piece.sawWork) {
          finishPiece();
        } else {
          setStatus('connected');
        }
      });

      const onRowSummary = current((rowSummary) => {
        const piece = pieceRef.current;
        // A summary arriving before any work belongs to an earlier piece.
        if (!piece.sawWork) return;
        if (!piece.summaryBuilt) {
          piece.rowSummary = rowSummary;
          finishPiece();
          return;
        }
        // Already ended by a status packet or END. A 0039 ending well before that
        // piece did is the next piece's and must not overwrite an unsaved summary.
        const ref = summaryReference(piece.samples, piece.lastSample);
        if (ref && rowSummary.elapsedTime < ref.elapsedTime - REFINE_MARGIN_S) {
          return;
        }
        piece.rowSummary = rowSummary;
        // Refine only what 0039 carries.
        const refined = buildPM5Summary(piece);
        setSummary((prev) =>
          prev
            ? {
                ...prev,
                elapsedTime: refined.elapsedTime,
                elapsedStr: refined.elapsedStr,
                distance: refined.distance,
                avgSpm: refined.avgSpm,
              }
            : prev
        );
      });

      deviceRef.current = device;

      device.addEventListener(
        'gattserverdisconnected',
        current(() => {
          setStatus('idle');
          setMetrics(null);
        })
      );

      await subscribe(chars.generalStatus, parseGeneralStatus, onGeneralStatus);
      await subscribeOptional(
        chars.additionalStatus1,
        errors.additionalStatus1,
        parseAdditionalStatus1,
        current((add1) => {
          pieceRef.current.add1 = add1;
        }),
        '0032'
      );
      await subscribeOptional(
        chars.additionalStatus2,
        errors.additionalStatus2,
        parseAdditionalStatus2,
        current((add2) => {
          pieceRef.current.add2 = add2;
        }),
        '0033'
      );
      await subscribeOptional(
        chars.workoutSummary,
        errors.workoutSummary,
        parseRowingSummary,
        onRowSummary,
        '0039'
      );
    },
    [finishPiece]
  );

  // On Android, Connect opens the list of PM5s in range; in the browser it
  // opens the browser's own chooser, as before.
  const connect = useCallback(async () => {
    setError(null);
    setErrorCode(null);
    setSummary(null);
    pieceRef.current = freshPiece();
    if (Capacitor.isNativePlatform()) {
      rowsRef.current = [];
      setMonitors([]);
      setConnectingId(null);
      autoSkipRef.current = null;
      return beginScan();
    }
    setStatus('connecting');
    attemptRef.current += 1;
    const attempt = attemptRef.current;

    let device = null;
    try {
      const connected = await connectToPM5();
      device = connected.device;
      await startPiece(connected, attempt);
      if (device?.id) writeLastPm5Id(device.id);

      // 0031 packets can land during the awaits above; don't clobber them.
      setStatus((prev) => (prev === 'connecting' ? 'connected' : prev));
    } catch (err) {
      // Only failures after the link is up are reported: before that the
      // rejection is usually the user dismissing the device chooser.
      if (device) {
        captureError(err, { source: 'pm5Bluetooth' });
        disconnectPM5(device);
        deviceRef.current = null;
      }
      setError(err.message);
      setErrorCode(typeof err.code === 'string' ? err.code : null);
      setStatus('error');
    }
  }, [beginScan, startPiece]);

  // The user tapped a row. Only that id is ever connected, and further taps
  // are ignored until this attempt ends.
  const choose = useCallback(
    async (id) => {
      if (connectingRef.current || !choosingRef.current) return;
      if (!rowsRef.current.some((m) => m.id === id && !m.stale)) return;
      // A new generation, so a scan still starting behind the list (after a
      // failed connect) stops when it arrives instead of running on.
      genRef.current += 1;
      const gen = genRef.current;
      attemptRef.current += 1;
      const attempt = attemptRef.current;
      connectingRef.current = id;
      setConnectingId(id);
      setError(null);
      setErrorCode(null);
      stopScanning();
      const abort = new window.AbortController();
      connectAbortRef.current = abort;

      // Failure keeps the rows and scans again, so the user can tap again.
      const backToList = (err) => {
        attemptRef.current += 1;
        connectAbortRef.current = null;
        connectingRef.current = null;
        setConnectingId(null);
        if (autoConnectingRef.current) {
          autoSkipRef.current = id;
          autoConnectingRef.current = false;
        }
        setError(err.message);
        setErrorCode(typeof err.code === 'string' ? err.code : null);
        beginScan();
      };

      let connected;
      try {
        connected = await connectToChosenPM5(id, { signal: abort.signal });
      } catch (err) {
        if (gen === genRef.current) backToList(err);
        return;
      }
      if (gen !== genRef.current) {
        disconnectPM5(connected.device);
        return;
      }
      try {
        await startPiece(connected, attempt);
      } catch (err) {
        // Before the disconnect, whose event must not reset the list.
        attemptRef.current += 1;
        captureError(err, { source: 'pm5Bluetooth' });
        disconnectPM5(connected.device);
        deviceRef.current = null;
        if (gen !== genRef.current) return;
        const failed = new Error(err.message, { cause: err });
        failed.code = PM5_CONNECT_FAILED;
        backToList(failed);
        return;
      }
      if (gen !== genRef.current) {
        disconnectPM5(connected.device);
        deviceRef.current = null;
        return;
      }
      stopScanning();
      connectAbortRef.current = null;
      connectingRef.current = null;
      choosingRef.current = false;
      autoConnectingRef.current = false;
      rowsRef.current = [];
      setMonitors([]);
      setConnectingId(null);
      writeLastPm5Id(id);
      // 0031 packets can land during the awaits above; don't clobber them.
      setStatus((prev) => (prev === 'choosing' ? 'connected' : prev));
    },
    [beginScan, startPiece, stopScanning]
  );

  useEffect(() => {
    chooseRef.current = choose;
  }, [choose]);

  const retryScan = useCallback(() => {
    setError(null);
    setErrorCode(null);
    rowsRef.current = [];
    setMonitors([]);
    return beginScan();
  }, [beginScan]);

  // Manual END: the PM5 may never send an end state (Just Row), so build the
  // summary from what has been seen rather than dropping the session.
  function finish() {
    finishPiece();
  }

  const disconnect = useCallback(() => {
    disconnectPM5(deviceRef.current);
    deviceRef.current = null;
    setStatus('idle');
    setMetrics(null);
  }, []);

  function reset() {
    disconnect();
    setSummary(null);
    setError(null);
    setErrorCode(null);
  }

  return {
    status,
    metrics,
    summary,
    error,
    errorCode,
    connect,
    disconnect,
    reset,
    finish,
    monitors,
    scanPhase,
    connectingId,
    locationOff,
    choose,
    retryScan,
    cancelScan: leaveList,
  };
}
