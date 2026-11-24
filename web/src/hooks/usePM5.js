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
  // idle | connecting | connected | rowing | finished | error
  const [metrics, setMetrics] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  // Set only for errors pm5Bluetooth.js throws with a string code; a browser
  // DOMException's numeric legacy `code` is not one of ours.
  const [errorCode, setErrorCode] = useState(null);

  const deviceRef = useRef(null);
  // Notification callbacks are created once per connect, so everything they
  // read lives in this ref; React state inside them would be a stale closure.
  const pieceRef = useRef(freshPiece());

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
        disconnectPM5(deviceRef.current);
        deviceRef.current = null;
        setStatus('idle');
        setMetrics(null);
      }
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, []);

  const finishPiece = useCallback(() => {
    const piece = pieceRef.current;
    if (piece.summaryBuilt) return;
    piece.summaryBuilt = true;
    setSummary(buildPM5Summary(piece));
    setStatus('finished');
  }, []);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError(null);
    setErrorCode(null);
    setSummary(null);
    pieceRef.current = freshPiece();

    const onGeneralStatus = (general) => {
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
    };

    const onRowSummary = (rowSummary) => {
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
    };

    let device = null;
    try {
      const connected = await connectToPM5();
      device = connected.device;
      const { chars, errors = {} } = connected;
      deviceRef.current = device;

      device.addEventListener('gattserverdisconnected', () => {
        setStatus('idle');
        setMetrics(null);
      });

      await subscribe(chars.generalStatus, parseGeneralStatus, onGeneralStatus);
      await subscribeOptional(
        chars.additionalStatus1,
        errors.additionalStatus1,
        parseAdditionalStatus1,
        (add1) => {
          pieceRef.current.add1 = add1;
        },
        '0032'
      );
      await subscribeOptional(
        chars.additionalStatus2,
        errors.additionalStatus2,
        parseAdditionalStatus2,
        (add2) => {
          pieceRef.current.add2 = add2;
        },
        '0033'
      );
      await subscribeOptional(
        chars.workoutSummary,
        errors.workoutSummary,
        parseRowingSummary,
        onRowSummary,
        '0039'
      );

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
  }, [finishPiece]);

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
  };
}
