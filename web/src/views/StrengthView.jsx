import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import StrengthTooltip from '../components/StrengthTooltip.jsx';
import LogEntry from '../components/LogEntry.jsx';
import { THEME } from '../constants/theme.js';
import { alpha } from '../utils/themeCss.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { useLiftHistory } from '../hooks/useLiftHistory.js';
import { loadDraft } from '../utils/strengthDraft.js';

// The logger is the heaviest file in the repo, so it stays its own chunk and
// loads only when someone opens it from here.
const StrengthLogger = lazy(() => import('../StrengthLogger.jsx'));

const actionRowStyle = {
  display: 'flex',
  marginBottom: SPACE.md,
};

const buttonType = {
  borderRadius: RADIUS.sm,
  padding: `${SPACE.sm}px ${SPACE.lg}px`,
  fontSize: TYPE.label.size,
  fontWeight: TYPE.label.weight,
  letterSpacing: TYPE.label.letterSpacing,
  fontFamily: FONT.sans,
  cursor: 'pointer',
};

const statusStyle = {
  padding: '20px 0',
  textAlign: 'center',
  color: THEME.textDim,
  fontSize: 11,
};

function LiftTrend({ lifts, active, onSelect }) {
  const liftColor = THEME.accent;
  const series = lifts[active];
  const latest = series.slice(-1)[0];
  const diff = latest.e1rm - series[0].e1rm;

  return (
    <>
      {/* Lift selector */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        {Object.keys(lifts).map((lift) => (
          <button
            key={lift}
            onClick={() => onSelect(lift)}
            style={{
              background:
                active === lift ? alpha(liftColor, '20') : 'transparent',
              border:
                active === lift
                  ? `1px solid ${liftColor}`
                  : `1px solid ${THEME.border}`,
              color: active === lift ? liftColor : THEME.muted,
              borderRadius: 4,
              padding: '5px 10px',
              fontSize: 9,
              letterSpacing: 0.5,
              cursor: 'pointer',
              fontFamily: FONT.mono,
            }}
          >
            {lift}
          </button>
        ))}
      </div>

      <div
        style={{
          fontSize: 9,
          letterSpacing: 3,
          color: liftColor,
          marginBottom: 12,
        }}
      >
        {active.toUpperCase()} · e1RM (kg)
      </div>
      {series.length > 1 ? (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart
            data={series}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <XAxis
              dataKey="date"
              tick={{
                fontSize: 9,
                fill: THEME.muted,
                fontFamily: FONT.mono,
              }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{
                fontSize: 9,
                fill: THEME.muted,
                fontFamily: FONT.mono,
              }}
              tickFormatter={(v) => `${v}kg`}
              axisLine={false}
              tickLine={false}
              width={42}
            />
            <Tooltip content={<StrengthTooltip />} />
            <Line
              type="monotone"
              dataKey="e1rm"
              stroke={liftColor}
              strokeWidth={2}
              dot={{
                r: 4,
                fill: liftColor,
                stroke: THEME.field,
                strokeWidth: 1,
              }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div style={statusStyle}>
          One data point — chart builds as sessions are logged
        </div>
      )}
      {/* Latest e1rm callout */}
      <div
        style={{
          marginTop: 10,
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 700, color: liftColor }}>
          {latest.e1rm}kg
        </span>
        <span style={{ fontSize: 10, color: THEME.muted }}>
          current e1RM · {latest.date}
        </span>
        {series.length > 1 && (
          <span
            style={{
              fontSize: 10,
              color: diff >= 0 ? THEME.positive : THEME.muted,
            }}
          >
            {diff >= 0 ? '+' : ''}
            {diff.toFixed(1)}kg
          </span>
        )}
      </div>
    </>
  );
}

export default function StrengthView({ strengthSessions }) {
  const { t } = useLingui();
  const [activeLift, setActiveLift] = useState(null);
  const { data, isPending, isError } = useLiftHistory();
  // Section-local mode. The logger is unmounted on Leave and mounted fresh on
  // re-open, so its own init re-reads the draft and offers to resume it.
  const [logging, setLogging] = useState(false);
  // In the initializer, not in render: loadDraft removes a malformed key.
  const [hasDraft, setHasDraft] = useState(() => loadDraft() != null);
  const actionRef = useRef(null);
  const leaveRef = useRef(null);
  // Set only by closeLogger, so the action button is not focused on first mount.
  const returnFocus = useRef(false);

  // The button that had focus unmounts on each switch, so hand focus to the
  // other one rather than let it fall to <body>.
  useEffect(() => {
    if (logging) {
      leaveRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      actionRef.current?.focus();
    }
  }, [logging]);

  const closeLogger = () => {
    setHasDraft(loadDraft() != null);
    returnFocus.current = true;
    setLogging(false);
  };

  if (logging) {
    return (
      <>
        <div style={{ ...actionRowStyle, justifyContent: 'flex-start' }}>
          <button
            ref={leaveRef}
            type="button"
            onClick={closeLogger}
            aria-label={t({
              message: 'Leave logger, back to strength trends',
              comment: 'Accessible name of the Leave logger button',
            })}
            style={{
              ...buttonType,
              background: 'transparent',
              border: `1px solid ${THEME.border}`,
              color: THEME.muted,
            }}
          >
            <Trans comment="Button: close the strength logger and return to strength trends">
              ← Leave logger
            </Trans>
          </button>
        </div>
        <Suspense fallback={null}>
          <StrengthLogger />
        </Suspense>
      </>
    );
  }

  const actionRow = (
    <div style={{ ...actionRowStyle, justifyContent: 'flex-end' }}>
      <button
        ref={actionRef}
        type="button"
        onClick={() => setLogging(true)}
        style={{
          ...buttonType,
          background: THEME.accent,
          color: THEME.surface,
          border: 'none',
        }}
      >
        {hasDraft ? (
          <Trans comment="Button: reopen the logger with an unfinished session">
            Resume session
          </Trans>
        ) : (
          <Trans comment="Button: open the strength logger">
            Log a session
          </Trans>
        )}
      </button>
    </div>
  );

  let body;
  if (isPending) {
    body = <div style={statusStyle}>Loading strength history…</div>;
  } else if (isError) {
    body = <div style={statusStyle}>Strength history unavailable.</div>;
  } else if (data.setCount === 0) {
    body = <div style={statusStyle}>No strength sets logged yet.</div>;
  } else if (data.scoredCount === 0) {
    body = (
      <div style={statusStyle}>
        {data.setCount} sets logged — none with weight and reps to estimate
        e1RM.
      </div>
    );
  } else {
    const active = data.lifts[activeLift]
      ? activeLift
      : Object.keys(data.lifts)[0];
    body = (
      <LiftTrend lifts={data.lifts} active={active} onSelect={setActiveLift} />
    );
  }

  return (
    <>
      {actionRow}

      {/* e1RM chart */}
      <div
        style={{
          background: THEME.raised,
          border: `1px solid ${THEME.border}`,
          borderRadius: 6,
          padding: '14px 16px',
          marginBottom: 12,
        }}
      >
        {body}
      </div>

      {/* Strength session list */}
      <div
        style={{
          fontSize: 9,
          letterSpacing: 3,
          color: THEME.muted,
          marginBottom: 8,
        }}
      >
        STRENGTH SESSIONS
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {strengthSessions
          .slice()
          .reverse()
          .map((entry, i) => (
            <LogEntry key={i} entry={entry} />
          ))}
      </div>
    </>
  );
}
