import { useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { useAnchors } from '../hooks/useAnchors.js';
import Button from '../components/Button.jsx';
import IntervalBuilder from './IntervalBuilder.jsx';
import SplitTable from './SplitTable.jsx';
import {
  bandForInterval,
  classifyBand,
  createWorkout,
  currentInterval,
  formatPace,
  resolvedCp,
  term,
} from './intervalModel.js';
import { readSavedWorkout, saveWorkout } from './liveErgFlag.js';
import {
  createSplitTracker,
  currentSplitOf,
  trackSample,
} from './pm5Splits.js';

// Band colour is never the only signal: the arrow and word sit beside it.
const BAND_INK = {
  in: THEME.accent,
  under: THEME.caution,
  over: THEME.warning,
  none: THEME.muted,
};

const labelStyle = {
  fontFamily: FONT.sans,
  fontSize: TYPE.label.size,
  fontWeight: TYPE.label.weight,
  letterSpacing: TYPE.label.letterSpacing,
  lineHeight: TYPE.label.lineHeight,
  textTransform: 'uppercase',
  color: THEME.muted,
};

const bodyStyle = {
  margin: 0,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.body.weight,
  lineHeight: TYPE.body.lineHeight,
  color: THEME.text,
};

const card = {
  background: THEME.surface,
  borderRadius: RADIUS.md,
  padding: SPACE.lg,
  marginBottom: SPACE.md,
};

// The plan on this phone: whatever was last built in the planner or on the
// live screen, else a fresh four-interval workout from critical power. The
// planner at home and the live screen at the gym open the same plan.
function initialWorkout(cp, storage) {
  return (
    readSavedWorkout(storage) ?? createWorkout({ type: 'int', reps: 4 }, cp)
  );
}

// The v10 live screen, fed by ErgLiveView's usePM5 samples. Connecting, the
// PM5 list, the summary and saving all stay with ErgLiveView.
export function LiveErgSessionView({
  metrics = null,
  status = 'connected',
  onEnd,
  cp = null,
  termsMode = 'rowing',
  storage,
}) {
  const [workout, setWorkout] = useState(() => initialWorkout(cp, storage));
  // A plan saved earlier (the planner at home, or the last piece) is what
  // opened here; say so, so it is not mistaken for a blank builder.
  const [planLoaded] = useState(() => readSavedWorkout(storage) !== null);
  const [tracker, setTracker] = useState(createSplitTracker);
  const [seen, setSeen] = useState(null);
  const [seenCp, setSeenCp] = useState(cp);
  if (cp !== seenCp) {
    // CP lands after the anchors query; re-seed an unsaved plan from it.
    setSeenCp(cp);
    if (tracker.phase === 'ready' && !readSavedWorkout(storage)) {
      setWorkout(createWorkout({ type: 'int', reps: 4 }, cp));
    }
  }
  if (metrics !== seen) {
    // Adjusting state from a new sample during render, not in an effect.
    setSeen(metrics);
    setTracker(trackSample(tracker, metrics, workout));
  }

  const changeWorkout = (next) => {
    setWorkout(next);
    saveWorkout(next, storage);
  };

  const { placeholder } = resolvedCp(cp);
  const phase = tracker.phase;
  const iv = currentInterval(workout, tracker.intervalNo);
  const band = bandForInterval(workout, tracker.intervalNo);
  const watts = metrics?.watts ?? null;
  const verdict =
    phase === 'work' && watts != null ? classifyBand(watts, band) : null;
  const current = currentSplitOf(tracker, workout);

  return (
    <main
      data-testid="live-erg-session"
      data-phase={phase}
      style={{
        minHeight: '100%',
        boxSizing: 'border-box',
        padding: SPACE.lg,
        background: THEME.bg,
        color: THEME.text,
        fontFamily: FONT.sans,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SPACE.sm,
          marginBottom: SPACE.md,
        }}
      >
        <h1
          style={{
            flex: 1,
            margin: 0,
            color: THEME.text,
            fontFamily: FONT.sans,
            fontSize: TYPE.title.size,
            fontWeight: TYPE.title.weight,
            letterSpacing: TYPE.title.letterSpacing,
            lineHeight: TYPE.title.lineHeight,
          }}
        >
          Live session
        </h1>
        <span style={labelStyle}>v10 beta</span>
        {onEnd && (status === 'connected' || status === 'rowing') && (
          <button
            type="button"
            onClick={onEnd}
            style={{
              minHeight: 44,
              padding: `0 ${SPACE.md}px`,
              border: `1px solid ${THEME.border}`,
              borderRadius: RADIUS.md,
              background: THEME.raised,
              color: THEME.text,
              fontFamily: FONT.sans,
              fontSize: TYPE.body.size,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            End {term('piece', termsMode).toLowerCase()}
          </button>
        )}
      </header>

      {phase === 'ready' && (
        <>
          <section style={card} aria-label="Before you row">
            <p style={bodyStyle}>
              {planLoaded
                ? 'PM5 connected. Your saved plan is loaded; change it here if you need to. '
                : 'PM5 connected. Build your intervals here. '}
              Set the same workout on the PM5 (Intervals, then Variable) and
              start rowing. SplitIQ follows each interval{'\u2019'}s target
              here. Sending the workout from the phone comes next.
            </p>
            {placeholder && (
              <p
                style={{
                  ...bodyStyle,
                  marginTop: SPACE.sm,
                  color: THEME.muted,
                }}
              >
                Watt targets start from a 200 W critical power placeholder until
                onboarding sets yours.
              </p>
            )}
          </section>
          <IntervalBuilder
            workout={workout}
            onChange={changeWorkout}
            termsMode={termsMode}
          />
        </>
      )}

      {phase !== 'ready' && (
        <>
          <section
            aria-label="Now"
            aria-live="polite"
            style={{
              ...card,
              display: 'flex',
              flexDirection: 'column',
              gap: SPACE.xs,
            }}
          >
            {phase === 'rest' && (
              <div style={{ ...bodyStyle, fontWeight: 700 }}>
                {term('rest', termsMode)}
                {iv
                  ? ` \u00b7 next: ${term('interval', termsMode)} ${tracker.intervalNo} \u00b7 ${iv.watts} W \u00b7 ${iv.rate} ${term('spm', termsMode)}`
                  : ''}
              </div>
            )}
            {phase === 'done' && (
              <div style={{ ...bodyStyle, fontWeight: 700 }}>
                {term('piece', termsMode)} done
              </div>
            )}
            {phase === 'work' && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: SPACE.sm,
                  }}
                >
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: TYPE.display.size,
                      fontWeight: 700,
                      color: THEME.textStrong,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {watts != null ? `${watts} W` : '\u2014'}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT.mono,
                      fontSize: TYPE.body.size,
                      color: THEME.muted,
                    }}
                  >
                    {formatPace(
                      metrics?.pace500 > 0 ? metrics.pace500 / 100 : null
                    )}{' '}
                    {term('splitPace', termsMode)}
                  </span>
                </div>
                {verdict && (
                  <div
                    data-testid="live-erg-band"
                    data-band={verdict.dir}
                    style={{
                      ...bodyStyle,
                      fontWeight: 700,
                      color: BAND_INK[verdict.dir] || THEME.text,
                    }}
                  >
                    {verdict.label}
                  </div>
                )}
                {iv && (
                  <div style={{ ...bodyStyle, color: THEME.muted }}>
                    {term('interval', termsMode)} {tracker.intervalNo}{' '}
                    {'\u00b7'} {term('rate', termsMode)} {iv.rate}{' '}
                    {term('spm', termsMode)} target
                    {metrics?.strokeRate != null
                      ? ` \u00b7 ${metrics.strokeRate} now`
                      : ''}{' '}
                    {'\u00b7'} phone only
                  </div>
                )}
              </>
            )}
          </section>
          <SplitTable
            workout={workout}
            splits={tracker.splits}
            current={current}
            phase={phase}
            termsMode={termsMode}
          />
        </>
      )}
    </main>
  );
}

// Reads CP from the rowing_cp anchor; LiveErgSessionView falls back to the
// labelled 200 W placeholder when it is missing.
export default function LiveErgSession(props) {
  const { cp } = useAnchors();
  return <LiveErgSessionView {...props} cp={cp} />;
}

const planNoteStyle = {
  margin: 0,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.body.weight,
  lineHeight: TYPE.body.lineHeight,
  color: THEME.muted,
};

// Plan a piece with no PM5 in range. Every change is saved on this phone under
// the key the live screen loads from, so connecting at the gym opens the same
// plan. Nothing here touches Bluetooth or Supabase.
export function LiveErgPlannerView({
  onStart,
  cp = null,
  termsMode = 'rowing',
  storage,
}) {
  const { t } = useLingui();
  const [workout, setWorkout] = useState(() => initialWorkout(cp, storage));
  const [seenCp, setSeenCp] = useState(cp);
  if (cp !== seenCp) {
    // CP lands after the anchors query; re-seed a plan nobody has saved yet.
    setSeenCp(cp);
    if (!readSavedWorkout(storage)) {
      setWorkout(createWorkout({ type: 'int', reps: 4 }, cp));
    }
  }
  const { placeholder } = resolvedCp(cp);

  const change = (next) => {
    setWorkout(next);
    saveWorkout(next, storage);
  };

  return (
    <div
      data-testid="live-erg-planner"
      style={{
        boxSizing: 'border-box',
        minHeight: '100%',
        padding: `${SPACE.sm}px ${SPACE.lg}px ${SPACE.xl}px`,
        background: THEME.bg,
        color: THEME.text,
        fontFamily: FONT.sans,
      }}
    >
      <h1
        style={{
          margin: `0 0 ${SPACE.sm}px`,
          color: THEME.text,
          fontFamily: FONT.sans,
          fontSize: TYPE.title.size,
          fontWeight: TYPE.title.weight,
          letterSpacing: TYPE.title.letterSpacing,
          lineHeight: TYPE.title.lineHeight,
        }}
      >
        {t`Plan a session`}
      </h1>
      <section
        aria-label={t`About this plan`}
        style={{
          background: THEME.surface,
          borderRadius: RADIUS.md,
          padding: SPACE.lg,
          marginBottom: SPACE.md,
        }}
      >
        <p style={{ ...planNoteStyle, color: THEME.text }}>
          {t`No PM5 needed. Every change saves on this phone, and the live screen opens with this plan when you connect.`}
        </p>
        {placeholder && (
          <p style={{ ...planNoteStyle, marginTop: SPACE.sm }}>
            {t`Watt targets start from a 200 W critical power placeholder until onboarding sets yours.`}
          </p>
        )}
      </section>
      <IntervalBuilder
        workout={workout}
        onChange={change}
        termsMode={termsMode}
      />
      {onStart && (
        <div style={{ marginTop: SPACE.md }}>
          <Button variant="primary" onClick={onStart}>
            {t`Start on PM5`}
          </Button>
        </div>
      )}
    </div>
  );
}

export function LiveErgPlanner(props) {
  const { cp } = useAnchors();
  return <LiveErgPlannerView {...props} cp={cp} />;
}
