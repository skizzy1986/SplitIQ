import { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { parseBirthYear } from '../utils/trainingSettings.js';

const buttonStyle = (disabled) => ({
  minHeight: 44,
  padding: `0 ${SPACE.lg}px`,
  border: `1px solid ${THEME.border}`,
  borderRadius: RADIUS.sm,
  background: disabled ? THEME.border : THEME.raised,
  color: THEME.text,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  cursor: disabled ? 'default' : 'pointer',
});

// Year of birth (#819, H 13): saved to the account, used only for the
// maximum-heart-rate estimate, and removable. Props in, nothing fetched.
// `onSave(year)` and `onRemove()` return a promise that rejects when the save
// fails. The year is never put in a log or an error context (AC 42).
export default function BirthYearForm({ birthYear = null, onSave, onRemove }) {
  const { t } = useLingui();
  const [value, setValue] = useState(
    birthYear != null ? String(birthYear) : ''
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const run = async (action, done) => {
    setBusy(true);
    setStatus(null);
    try {
      await action();
      setStatus(done);
    } catch {
      // The save already reported itself through react-query's handlers.
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    const parsed = parseBirthYear(value);
    if (!parsed.ok) {
      setStatus(parsed.code);
      return;
    }
    run(() => onSave(parsed.year), 'saved');
  };

  const remove = () =>
    run(async () => {
      await onRemove();
      setValue('');
    }, 'removed');

  return (
    <form
      onSubmit={save}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.sm,
        fontFamily: FONT.sans,
      }}
    >
      <label
        htmlFor="birth-year"
        style={{
          fontSize: TYPE.bodySm.size,
          color: THEME.muted,
        }}
      >
        <Trans comment="Label above the year-of-birth field">
          Year of birth
        </Trans>
      </label>
      <div style={{ display: 'flex', gap: SPACE.sm }}>
        <input
          id="birth-year"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label={t({
            message: 'Year of birth',
            comment: 'Accessible name of the year-of-birth field',
          })}
          style={{
            flex: 1,
            minHeight: 44,
            padding: '0 12px',
            background: THEME.field,
            border: `1px solid ${THEME.textFaint}`,
            borderRadius: RADIUS.sm,
            color: THEME.text,
            fontFamily: FONT.mono,
            fontSize: TYPE.body.size,
            boxSizing: 'border-box',
          }}
        />
        <button type="submit" disabled={busy} style={buttonStyle(busy)}>
          <Trans comment="Button: save the year of birth">Save</Trans>
        </button>
        {birthYear != null && (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            style={buttonStyle(busy)}
          >
            <Trans comment="Button: remove the saved year of birth">
              Remove
            </Trans>
          </button>
        )}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: TYPE.bodySm.size,
          lineHeight: TYPE.bodySm.lineHeight,
          color: THEME.muted,
        }}
      >
        <Trans comment="Privacy note under the year-of-birth field. Backups: an earlier backup copy can still hold a removed value.">
          Used only to estimate your maximum heart rate. You can remove it at
          any time. A backup made earlier can still hold it until that backup is
          retired.
        </Trans>
      </p>
      {status && (
        <div
          role="status"
          style={{
            fontSize: TYPE.bodySm.size,
            color:
              status === 'saved' || status === 'removed'
                ? THEME.positive
                : THEME.warning,
          }}
        >
          {status === 'saved' && <Trans>Saved.</Trans>}
          {status === 'removed' && (
            <Trans comment="Confirmation after removing the year of birth">
              Removed.
            </Trans>
          )}
          {status === 'invalid' && (
            <Trans comment="Error: the year of birth is not a four-digit year">
              Enter a four-digit year, such as 1985.
            </Trans>
          )}
          {status === 'too_young' && (
            <Trans comment="Error: the app is for people 18 or over">
              SplitIQ is for people 18 or over.
            </Trans>
          )}
          {status === 'error' && (
            <Trans comment="Error: a save did not go through">
              Could not save that. Try again.
            </Trans>
          )}
        </div>
      )}
    </form>
  );
}
