import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import {
  MAX_INTERVALS,
  addInterval,
  formatDuration,
  formatMetres,
  intervalsOf,
  moveInterval,
  planCount,
  planLength,
  removeInterval,
  setIntervalUnit,
  stepIntervalField,
  term,
  validateWorkout,
} from './intervalModel.js';

const TAP = 44;

function labelStyle(extra) {
  return {
    fontFamily: FONT.sans,
    fontSize: TYPE.label.size,
    fontWeight: TYPE.label.weight,
    letterSpacing: TYPE.label.letterSpacing,
    lineHeight: TYPE.label.lineHeight,
    textTransform: 'uppercase',
    color: THEME.muted,
    marginBottom: SPACE.xs,
    ...extra,
  };
}

function StepButton({ children, ariaLabel, onClick, disabled }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        width: TAP,
        height: TAP,
        minWidth: TAP,
        minHeight: TAP,
        padding: 0,
        border: 'none',
        borderRadius: RADIUS.md,
        background: THEME.raised,
        color: THEME.text,
        fontFamily: FONT.sans,
        fontSize: 20,
        fontWeight: 600,
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function MiniStep({ label, value, ariaLabel, onDown, onUp, trailing }) {
  return (
    <div role="group" aria-label={ariaLabel} style={{ minWidth: 0 }}>
      <div
        style={labelStyle({
          display: 'flex',
          alignItems: 'baseline',
          gap: SPACE.xs,
          flexWrap: 'wrap',
        })}
      >
        <span>{label}</span>
        {trailing}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: SPACE.sm,
        }}
      >
        <StepButton ariaLabel={`${ariaLabel}, less`} onClick={onDown}>
          {'\u2212'}
        </StepButton>
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 20,
            fontWeight: 700,
            color: THEME.textStrong,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
        <StepButton ariaLabel={`${ariaLabel}, more`} onClick={onUp}>
          +
        </StepButton>
      </div>
    </div>
  );
}

function Chip({ pressed, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      style={{
        minHeight: TAP,
        padding: `0 ${SPACE.md}px`,
        border: 'none',
        borderRadius: RADIUS.md,
        background: pressed ? THEME.text : THEME.raised,
        color: pressed ? THEME.bg : THEME.text,
        fontFamily: FONT.sans,
        fontSize: TYPE.body.size,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// Controlled list of variable intervals. Each card sets its own length,
// rest, watt target and phone-only rate. The parent owns the workout.
export function IntervalBuilder({ workout, onChange, termsMode = 'rowing' }) {
  const list = intervalsOf(workout);
  const errors = validateWorkout(workout);
  const count = planCount(workout);
  const change = (next) => {
    if (onChange) onChange(next);
  };

  return (
    <div data-testid="live-erg-interval-builder">
      {list.map((iv, i) => {
        const work =
          iv.unit === 'm'
            ? `${formatMetres(iv.work)} m`
            : formatDuration(iv.work);
        const dn = iv.unit === 'm' ? -250 : -30;
        const up = iv.unit === 'm' ? 250 : 30;
        const n = i + 1;
        const workLabel = `Interval ${n} work`;
        return (
          <section
            key={`${i}-${iv.unit}-${iv.work}`}
            aria-label={`${term('interval', termsMode)} ${n} of ${list.length}`}
            style={{
              background: THEME.surface,
              borderRadius: RADIUS.md,
              padding: `${SPACE.md}px ${SPACE.md + SPACE.xs}px`,
              margin: `0 0 ${SPACE.sm + SPACE.xs}px`,
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: SPACE.sm,
                marginBottom: SPACE.sm,
              }}
            >
              <div
                style={{
                  flex: 1,
                  fontFamily: FONT.sans,
                  fontSize: 16,
                  fontWeight: 700,
                  color: THEME.text,
                }}
              >
                {term('interval', termsMode)} {n} of {list.length}
              </div>
              <StepButton
                ariaLabel="Move interval up"
                disabled={i === 0}
                onClick={() => change(moveInterval(workout, i, -1))}
              >
                {'\u2191'}
              </StepButton>
              <StepButton
                ariaLabel="Move interval down"
                disabled={i === list.length - 1}
                onClick={() => change(moveInterval(workout, i, 1))}
              >
                {'\u2193'}
              </StepButton>
              <StepButton
                ariaLabel="Remove interval"
                disabled={list.length <= 1}
                onClick={() => change(removeInterval(workout, i))}
              >
                {'\u00d7'}
              </StepButton>
            </div>
            <div
              role="group"
              aria-label={`Interval ${n} length unit`}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: SPACE.sm,
                marginBottom: SPACE.sm + SPACE.xs,
              }}
            >
              <Chip
                pressed={iv.unit === 'm'}
                onClick={() => change(setIntervalUnit(workout, i, 'm'))}
              >
                By metres
              </Chip>
              <Chip
                pressed={iv.unit === 's'}
                onClick={() => change(setIntervalUnit(workout, i, 's'))}
              >
                By time
              </Chip>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: SPACE.sm + SPACE.xs,
              }}
            >
              <MiniStep
                label="Work"
                value={work}
                ariaLabel={workLabel}
                onDown={() => change(stepIntervalField(workout, i, 'work', dn))}
                onUp={() => change(stepIntervalField(workout, i, 'work', up))}
              />
              <MiniStep
                label={term('rest', termsMode)}
                value={formatDuration(iv.rest)}
                ariaLabel={`Interval ${n} rest`}
                onDown={() =>
                  change(stepIntervalField(workout, i, 'rest', -15))
                }
                onUp={() => change(stepIntervalField(workout, i, 'rest', 15))}
              />
              <MiniStep
                label="Watts"
                value={`${iv.watts} W`}
                ariaLabel={`Interval ${n} watts`}
                onDown={() =>
                  change(stepIntervalField(workout, i, 'watts', -5))
                }
                onUp={() => change(stepIntervalField(workout, i, 'watts', 5))}
              />
              <MiniStep
                label={term('rate', termsMode)}
                trailing={
                  <span
                    style={{
                      fontSize: TYPE.label.size,
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      textTransform: 'none',
                      color: THEME.muted,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    phone only
                  </span>
                }
                value={`${iv.rate} ${term('spm', termsMode)}`}
                ariaLabel={`Interval ${n} rate`}
                onDown={() => change(stepIntervalField(workout, i, 'rate', -1))}
                onUp={() => change(stepIntervalField(workout, i, 'rate', 1))}
              />
            </div>
          </section>
        );
      })}
      <button
        type="button"
        disabled={list.length >= MAX_INTERVALS}
        onClick={() => change(addInterval(workout))}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          minHeight: 56,
          padding: `0 ${SPACE.lg}px`,
          border: `1.5px solid ${THEME.border}`,
          borderRadius: RADIUS.lg,
          background: 'transparent',
          color: THEME.text,
          fontFamily: FONT.sans,
          fontSize: 17,
          fontWeight: 700,
          opacity: list.length >= MAX_INTERVALS ? 0.4 : 1,
          cursor: list.length >= MAX_INTERVALS ? 'default' : 'pointer',
        }}
      >
        + Add interval
      </button>
      <p
        style={{
          margin: `${SPACE.sm + SPACE.xs}px 0 0`,
          color: THEME.muted,
          fontFamily: FONT.sans,
          fontSize: TYPE.body.size,
          fontWeight: TYPE.body.weight,
          lineHeight: TYPE.body.lineHeight,
        }}
      >
        Each interval has one set watt target and a stroke-rate target. Rate is
        shown and cued on the phone; the PM5 has no command for it. The PM5
        takes each interval{'\u2019'}s length, rest and power goal once
        {' \u2014 '}they don{'\u2019'}t repeat.
      </p>
      {errors.map((err) => (
        <div
          key={err}
          role="alert"
          style={{
            marginTop: SPACE.sm + SPACE.xs,
            padding: `${SPACE.sm + SPACE.xs}px ${SPACE.md}px`,
            borderRadius: RADIUS.sm + 2,
            background: THEME.raised,
            borderLeft: `4px solid ${THEME.text}`,
            color: THEME.text,
            fontFamily: FONT.sans,
            fontSize: TYPE.body.size,
            fontWeight: TYPE.body.weight,
            lineHeight: TYPE.body.lineHeight,
          }}
        >
          {err}
        </div>
      ))}
      <div
        style={{
          marginTop: SPACE.md,
          padding: SPACE.lg,
          background: THEME.surface,
          borderRadius: RADIUS.md,
        }}
      >
        <div style={labelStyle({ marginBottom: SPACE.sm })}>
          {errors.length ? 'This would need' : 'The PM5 will show'} {count}{' '}
          {count === 1
            ? term('interval', termsMode).toLowerCase()
            : term('intervals', termsMode).toLowerCase()}
        </div>
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: TYPE.body.size,
            lineHeight: 1.9,
            color: THEME.text,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {list.map((iv, i) => {
            const len = planLength(workout, i);
            return (
              <span
                key={`plan-${i}`}
                style={{ display: 'inline-block', minWidth: 160 }}
              >
                {i + 1}
                {'\u2002'}
                {len.text} {'\u00b7'} {iv.watts} W {'\u00b7'} {iv.rate}{' '}
                {term('spm', termsMode)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default IntervalBuilder;
