import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useSessionOwner } from '../hooks/useSessionOwner.js';
import { privateSessionGeneration } from '../utils/privateSessionState.js';
import { useQueryClient } from '@tanstack/react-query';
import { usePM5 } from '../hooks/usePM5';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { supabase } from '../supabaseClient';
import LiveMetric from '../components/LiveMetric';
import WorkoutTarget from '../components/WorkoutTarget';
import SessionExitBar from '../components/mobile/SessionExitBar.jsx';
import PM5Picker from '../components/PM5Picker';
import { parsePace, formatElapsed } from '../services/pm5Bluetooth';
import { THEME } from '../constants/theme.js';
import { toISODate, toLogDate } from '../utils/dateFormat.js';
import { invalidateSessionQueries } from '../utils/invalidateSessionQueries.js';
import { FONT } from '../constants/type.js';
import { SRPE_GUIDE } from '../constants/trainingConfig.js';
import { SRPE_GUIDE_MESSAGES } from '../constants/srpeGuideMessages.js';
import { PM5_ERROR_MESSAGES } from '../constants/pm5ErrorMessages.js';

// Values only: the band's words are looked up at render, in the active language.
const SRPE_BUTTONS = SRPE_GUIDE.flatMap((band) => {
  const [lo, hi] = band.range.split('-').map(Number);
  return Array.from({ length: hi - lo + 1 }, (_, i) => ({
    v: lo + i,
    range: band.range,
  }));
});

// ── SCREEN A: Connect ─────────────────────────────────────────────
function ConnectScreen({
  onConnect,
  connecting,
  error,
  errorCode,
  todaySession,
  pending,
}) {
  const { i18n } = useLingui();
  const errorText =
    errorCode && Object.hasOwn(PM5_ERROR_MESSAGES, errorCode)
      ? i18n._(PM5_ERROR_MESSAGES[errorCode])
      : error;
  return (
    <div
      style={{
        minHeight: 'calc(100vh - 80px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 3,
            color: THEME.muted,
            marginBottom: 8,
          }}
        >
          <Trans comment="Screen eyebrow, all capitals">LIVE ROWING</Trans>
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: THEME.positive,
            fontFamily: FONT.mono,
          }}
        >
          <Trans comment="Screen title, all capitals; C2 is Concept2, the rowing machine maker: keep it">
            C2 CONNECT
          </Trans>
        </div>
      </div>

      {todaySession && (
        <div style={{ width: '100%', maxWidth: 420 }}>
          <WorkoutTarget session={todaySession} />
        </div>
      )}

      {pending > 0 && (
        <div
          style={{
            fontSize: 10,
            letterSpacing: 2,
            color: THEME.caution,
            border: `1px solid ${THEME.caution}`,
            borderRadius: 6,
            padding: '6px 12px',
          }}
        >
          <Plural
            value={pending}
            one="# PENDING SYNC"
            other="# PENDING SYNC"
            comment="Erg sessions saved on the device, waiting to upload; all capitals"
          />
        </div>
      )}

      <div
        style={{
          textAlign: 'center',
          fontSize: 12,
          color: THEME.muted,
          lineHeight: 1.8,
          maxWidth: 300,
        }}
      >
        {Capacitor.isNativePlatform() ? (
          <Trans comment="Android app. PM5 is the rowing machine's monitor: keep it. Connect is the button below. The tags are line breaks">
            Power on your PM5.
            <br />
            Tap Connect, then choose your
            <br />
            monitor from the list.
          </Trans>
        ) : (
          <Trans comment="PM5 is the rowing machine's monitor: keep it. Connect is the button below. The tags are line breaks">
            Power on your PM5.
            <br />
            Tap Connect — your browser will
            <br />
            ask you to select the device.
          </Trans>
        )}
      </div>

      {error && (
        <div
          style={{
            background:
              'color-mix(in srgb, var(--color-critical) 12%, var(--color-bg))',
            border: `1px solid ${THEME.critical}`,
            borderRadius: 8,
            padding: '12px 16px',
            fontSize: 12,
            color: THEME.critical,
            maxWidth: 360,
            textAlign: 'center',
          }}
        >
          {errorText}
        </div>
      )}

      <button
        onClick={onConnect}
        disabled={connecting}
        style={{
          padding: '16px 48px',
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 2,
          background: connecting ? THEME.border : THEME.positive,
          color: THEME.surface,
          border: 'none',
          borderRadius: 10,
          cursor: connecting ? 'default' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {connecting ? (
          <Trans comment="Button, busy, all capitals">CONNECTING…</Trans>
        ) : (
          <Trans comment="Button, all capitals; PM5 is the rowing machine's monitor">
            CONNECT TO PM5
          </Trans>
        )}
      </button>

      <div style={{ fontSize: 10, color: THEME.textDim, letterSpacing: 1 }}>
        <Trans comment="Where live rowing works: browser names, then device kinds">
          Chrome / Edge · Android or Desktop
        </Trans>
      </div>
    </div>
  );
}

// ── SCREEN B: Live Rowing ─────────────────────────────────────────
function RowingScreen({ metrics, status, todaySession, onEnd }) {
  const { t } = useLingui();
  const isRowing = status === 'rowing';

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 80px)',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 16px 24px',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isRowing ? THEME.positive : THEME.muted,
              boxShadow: isRowing ? `0 0 8px ${THEME.positive}` : 'none',
            }}
          />
          <span
            style={{
              fontSize: 10,
              letterSpacing: 2,
              color: isRowing ? THEME.positive : THEME.muted,
            }}
          >
            {isRowing ? (
              <Trans comment="Live status, all capitals">ROWING</Trans>
            ) : (
              <Trans comment="Live status: the monitor is paired, all capitals">
                CONNECTED
              </Trans>
            )}
          </span>
        </div>
        <button
          onClick={onEnd}
          style={{
            padding: '6px 14px',
            fontSize: 10,
            letterSpacing: 1,
            background: 'transparent',
            border: `1px solid ${THEME.critical}`,
            borderRadius: 6,
            color: THEME.critical,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Trans comment="Button that ends the live session, all capitals">
            END
          </Trans>
        </button>
      </div>

      {/* Primary metric — 500m pace */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
        }}
      >
        <LiveMetric
          label={t({
            message: '500m PACE',
            comment: 'Live metric label: time per 500 metres; keep 500m',
          })}
          value={metrics?.paceStr ?? '--:--'}
          unit="/500m"
          accent={THEME.accent}
          size="large"
          dimmed={!isRowing}
        />

        {/* Secondary metrics row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 24,
            width: '100%',
            maxWidth: 380,
          }}
        >
          <LiveMetric
            label={t({ message: 'WATTS', comment: 'Live metric label' })}
            value={metrics?.watts}
            unit="W"
            accent={THEME.caution}
            dimmed={!isRowing}
          />
          <LiveMetric
            label="SPM"
            value={metrics?.strokeRate}
            unit="spm"
            accent={THEME.positive}
            dimmed={!isRowing}
          />
          <LiveMetric
            label={t({
              message: 'DIST',
              comment: 'Live metric label, short for distance',
            })}
            value={
              metrics?.distance != null ? Math.round(metrics.distance) : null
            }
            unit="m"
            accent={THEME.accent}
            dimmed={!isRowing}
          />
        </div>

        {/* Elapsed time */}
        <LiveMetric
          label={t({
            message: 'ELAPSED',
            comment: 'Live metric label: time since the start',
          })}
          value={metrics?.elapsedStr ?? '00:00'}
          accent="#a0a0b8"
          size="normal"
          dimmed={!isRowing}
        />
      </div>

      {/* Today's target (collapsible) */}
      {todaySession && (
        <div style={{ marginTop: 16 }}>
          <WorkoutTarget session={todaySession} />
        </div>
      )}
    </div>
  );
}

// ── SCREEN C: Session Summary + Save ─────────────────────────────
function SummaryScreen({ summary, onSave, onDiscard, onDone, saveState }) {
  const { t, i18n } = useLingui();
  const [srpe, setSrpe] = useState(5);
  const [notes, setNotes] = useState('');
  const saving = saveState === 'saving';
  const settled = saveState === 'saved' || saveState === 'queued';

  return (
    <div
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        minHeight: 'calc(100vh - 80px)',
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: 3, color: THEME.muted }}>
        <Trans comment="Screen eyebrow after the row ends, all capitals">
          SESSION COMPLETE
        </Trans>
      </div>

      {/* Totals */}
      <div
        style={{
          background: THEME.surface,
          border: `1px solid ${THEME.border}`,
          borderRadius: 10,
          padding: 20,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
        }}
      >
        <LiveMetric
          label={t({ message: 'DISTANCE', comment: 'All capitals' })}
          value={summary.distance}
          unit="m"
          accent={THEME.accent}
          size="normal"
        />
        <LiveMetric
          label={t({
            message: 'TIME',
            comment: 'Session total time, all capitals',
          })}
          value={summary.elapsedStr}
          accent="#a0a0b8"
          size="normal"
        />
        <LiveMetric
          label={t({
            message: 'AVG PACE',
            comment: 'Average time per 500 metres, all capitals',
          })}
          value={summary.avgPace ? parsePace(summary.avgPace) : '--'}
          unit="/500m"
          accent={THEME.accent}
          size="normal"
        />
        <LiveMetric
          label={t({
            message: 'AVG WATT',
            comment: 'Average power, all capitals',
          })}
          value={summary.avgWatts}
          unit="W"
          accent={THEME.caution}
          size="normal"
        />
        <LiveMetric
          label={t({
            message: 'AVG SPM',
            comment:
              'Average strokes per minute, all capitals; SPM stays as is',
          })}
          value={summary.avgSpm}
          unit="spm"
          accent={THEME.positive}
          size="normal"
        />
        <LiveMetric
          label={t({ message: 'CALORIES', comment: 'All capitals' })}
          value={summary.calories}
          unit="kcal"
          accent={THEME.muted}
          size="normal"
        />
      </div>

      {/* sRPE */}
      <div>
        <div
          style={{
            fontSize: 9,
            letterSpacing: 2,
            color: THEME.muted,
            marginBottom: 8,
          }}
        >
          <Trans comment="All capitals; sRPE stays as is">
            HOW HARD DID IT FEEL? (sRPE)
          </Trans>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          {SRPE_BUTTONS.map(({ v, range }) => (
            <button
              key={v}
              onClick={() => setSrpe(v)}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                borderRadius: 6,
                cursor: 'pointer',
                border: `1px solid ${srpe === v ? THEME.positive : THEME.border}`,
                background:
                  srpe === v
                    ? 'color-mix(in srgb, var(--color-positive) 12%, var(--color-bg))'
                    : 'transparent',
                color: srpe === v ? THEME.positive : THEME.muted,
                fontFamily: 'inherit',
              }}
            >
              {v} — {i18n._(SRPE_GUIDE_MESSAGES[range].label)}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <div
          style={{
            fontSize: 9,
            letterSpacing: 2,
            color: THEME.muted,
            marginBottom: 6,
          }}
        >
          <Trans comment="Field label; NOTES in capitals, optional in lower case">
            NOTES (optional)
          </Trans>
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t({
            message: 'How did it feel? Technique notes…',
            comment: 'Placeholder in the session notes box',
          })}
          rows={3}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            background: THEME.surface,
            border: `1px solid ${THEME.border}`,
            borderRadius: 6,
            color: THEME.text,
            fontFamily: 'inherit',
            fontSize: 12,
            padding: '10px 12px',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Outcome — the session stays on screen until DONE is pressed, so a
          failed save can never be mistaken for a successful one. */}
      {saveState === 'saved' && (
        <div
          style={{
            fontSize: 12,
            letterSpacing: 2,
            color: THEME.positive,
            border: `1px solid ${THEME.positive}`,
            borderRadius: 8,
            padding: '12px 16px',
            textAlign: 'center',
          }}
        >
          <Trans comment="Save succeeded, all capitals; Log is the session history">
            SAVED TO LOG
          </Trans>
        </div>
      )}
      {saveState === 'queued' && (
        <div
          style={{
            fontSize: 12,
            letterSpacing: 2,
            color: THEME.caution,
            border: `1px solid ${THEME.caution}`,
            borderRadius: 8,
            padding: '12px 16px',
            textAlign: 'center',
          }}
        >
          <Trans comment="Saved on the device while offline, uploads later; all capitals">
            SAVED LOCALLY — WILL SYNC
          </Trans>
        </div>
      )}
      {saveState === 'failed' && (
        <div
          style={{
            fontSize: 12,
            letterSpacing: 1,
            color: THEME.critical,
            border: `1px solid ${THEME.critical}`,
            borderRadius: 8,
            padding: '12px 16px',
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          <Trans comment="The session could not be saved anywhere; all capitals">
            SAVE FAILED — NOT STORED
          </Trans>
          <br />
          <span style={{ letterSpacing: 0, fontSize: 11 }}>
            <Trans comment="SAVE SESSION is the button's label: match its translation">
              Device storage is full. Free some space, then tap SAVE SESSION
              again.
            </Trans>
          </span>
        </div>
      )}

      {/* Actions */}
      {settled ? (
        <button
          onClick={onDone}
          style={{
            padding: '14px',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 1,
            background: THEME.positive,
            color: THEME.surface,
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Trans comment="Button that closes the summary, all capitals">
            DONE
          </Trans>
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => onSave({ srpe, notes })}
            disabled={saving}
            style={{
              flex: 1,
              padding: '14px',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 1,
              background: saving ? THEME.border : THEME.positive,
              color: THEME.surface,
              border: 'none',
              borderRadius: 8,
              cursor: saving ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {saving ? (
              <Trans>SAVING…</Trans>
            ) : (
              <Trans comment="Button, all capitals">SAVE SESSION</Trans>
            )}
          </button>
          <button
            onClick={onDiscard}
            style={{
              padding: '14px 20px',
              fontSize: 12,
              letterSpacing: 1,
              background: 'transparent',
              border: `1px solid ${THEME.border}`,
              borderRadius: 8,
              color: THEME.muted,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Trans comment="Button that throws the session away, all capitals">
              DISCARD
            </Trans>
          </button>
        </div>
      )}
    </div>
  );
}

// ── MAIN EXPORT ───────────────────────────────────────────────────
// Postgres unique_violation on sessions' UNIQUE(date, label). The row is
// already in the table, so this is a successful save, not a failure — queueing
// it would guarantee a permanently undrainable entry.
function isDuplicate(dbError) {
  return (
    dbError?.code === '23505' || /duplicate key/i.test(dbError?.message || '')
  );
}

export default function ErgLiveView({
  plannedSessions = [],
  onSessionSaved,
  onExit,
}) {
  const {
    status,
    metrics,
    summary,
    error,
    errorCode,
    connect,
    reset,
    finish,
    disconnect,
    monitors,
    scanPhase,
    connectingId,
    locationOff,
    choose,
    retryScan,
    cancelScan,
  } = usePM5();
  const { t } = useLingui();
  const { addToQueue, pending } = useOfflineQueue();
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState('idle');
  const ownerId = useSessionOwner();
  const [producerGeneration] = useState(privateSessionGeneration);
  const isCurrentProducer = () =>
    producerGeneration === privateSessionGeneration();
  // idle | saving | saved | queued | failed

  // sessions.date is text "M/D/YY", so both sides are normalised to ISO before
  // comparing. `_isErg` is the raw-type flag from useSessionLog — `type` has
  // already been through normType() by then and reads "Z2 Aerobic", never 'erg'.
  const todayISO = toISODate(toLogDate(new Date()));
  const todaySession =
    plannedSessions.find((s) => s._isErg && toISODate(s.date) === todayISO) ||
    null;

  async function saveSession({ srpe, notes }) {
    if (!isCurrentProducer()) return;
    setSaveState('saving');

    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    let user = null;
    let authFailed;
    try {
      const { data } = await supabase.auth.getUser();
      user = data?.user ?? null;
      authFailed = !user;
    } catch {
      authFailed = true;
    }

    // A deferred auth response must not reattribute the old screen's summary
    // after an account change. The owner context also covers offline auth failure.
    if (!isCurrentProducer()) return;
    if (ownerId && user && ownerId !== user.id) return;
    const userId = ownerId ?? user?.id;
    if (!userId) {
      setSaveState('failed');
      return;
    }

    const row = {
      date: toLogDate(now),
      type: 'erg',
      // Stays English in every language: this is the stored row, not the
      // screen (i18n SPEC, amendment 2026-11-14). The time suffix keeps
      // UNIQUE(date, label) satisfied for a second session on the same day.
      // Computed once here so it stays stable if the row goes to the offline
      // queue.
      label: `${todaySession?.label ?? 'Erg Session'} ${hhmm}`,
      duration: formatElapsed(summary.elapsedTime || 0),
      srpe,
      // `||` not `??` — the PM5 reports 0 when a field was never measured.
      distance_m: summary.distance || null,
      avg_watts: summary.avgWatts || null,
      status: 'logged',
      source: 'bluetooth',
      // Stored data, so English like the label above.
      exercises: notes ? [{ name: 'Notes', notes }] : [],
      user_id: userId,
    };

    const queue = () => {
      if (!isCurrentProducer()) return;
      try {
        if (addToQueue(row) === false) return;
        setSaveState('queued');
      } catch {
        // localStorage quota exceeded — the row is nowhere. Say so instead of
        // claiming a save.
        setSaveState('failed');
      }
    };

    if (authFailed || !navigator.onLine) {
      queue();
      return;
    }

    if (!isCurrentProducer()) return;
    let dbError;
    try {
      ({ error: dbError } = await supabase.from('sessions').insert(row));
    } catch (err) {
      dbError = err;
    }

    if (!isCurrentProducer()) return;
    if (!dbError || isDuplicate(dbError)) {
      invalidateSessionQueries(queryClient);
      setSaveState('saved');
    } else {
      queue();
    }
  }

  function done() {
    setSaveState('idle');
    reset();
    if (onSessionSaved) onSessionSaved();
  }

  let screen;
  if (status === 'idle' || status === 'error') {
    screen = (
      <ConnectScreen
        onConnect={connect}
        connecting={false}
        error={error}
        errorCode={errorCode}
        todaySession={todaySession}
        pending={pending}
      />
    );
  } else if (status === 'connecting') {
    screen = (
      <ConnectScreen
        onConnect={() => {}}
        connecting={true}
        error={null}
        todaySession={todaySession}
        pending={pending}
      />
    );
  } else if (status === 'choosing') {
    // Android only: the list of PM5s in range.
    screen = (
      <PM5Picker
        monitors={monitors}
        phase={scanPhase}
        connectingId={connectingId}
        errorCode={errorCode}
        locationOff={locationOff}
        onChoose={choose}
        onRetry={retryScan}
        onCancel={cancelScan}
      />
    );
  } else if (status === 'finished' && summary) {
    screen = (
      <SummaryScreen
        summary={summary}
        onSave={saveSession}
        onDiscard={() => {
          setSaveState('idle');
          reset();
        }}
        onDone={done}
        saveState={saveState}
      />
    );
  } else {
    screen = (
      <RowingScreen
        metrics={metrics}
        status={status}
        todaySession={todaySession}
        onEnd={finish}
      />
    );
  }

  if (!onExit) return screen;

  // What leaving would cost, if anything. Leaving unmounts this view, so a
  // connected PM5 and an unsaved summary would both be gone.
  const unsaved =
    status === 'finished' && saveState !== 'saved' && saveState !== 'queued';
  let confirm = null;
  if (status === 'connected' || status === 'rowing')
    confirm = t`Leave now? The PM5 disconnects and this piece is not saved.`;
  else if (unsaved) confirm = t`Leave without saving this piece?`;

  return (
    <>
      <SessionExitBar
        confirm={confirm}
        onExit={() => {
          disconnect();
          onExit();
        }}
      />
      {screen}
    </>
  );
}
