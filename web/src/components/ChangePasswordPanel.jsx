import { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { changePassword, MIN_PASSWORD } from '../utils/changePassword.js';

// Settings > Password, on the testers build (#792). Testers pick their password
// on the invite form; this is how they change it later.

const CAUSE_TEXT = {
  missing: msg({
    message: 'Fill in all three fields.',
    comment: 'Change-password error.',
  }),
  mismatch: msg({
    message: "The two new passwords don't match.",
    comment: 'Change-password error.',
  }),
  weak_password: msg({
    message: 'Choose a longer new password: at least {min} characters.',
    comment: 'Change-password error. {min} is the minimum length.',
  }),
  same: msg({
    message: 'The new password must be different from the current one.',
    comment: 'Change-password error.',
  }),
  wrong_current: msg({
    message: 'The current password is not right.',
    comment: 'Change-password error.',
  }),
  session: msg({
    message: 'Sign in again, then try once more.',
    comment: 'Change-password error when there is no session.',
  }),
  network: msg({
    message: 'Could not reach the server. Check your connection and try again.',
    comment: 'Change-password error when the device is offline.',
  }),
  failed: msg({
    message: 'The password could not be changed. Try again.',
    comment: 'Change-password error for any other cause.',
  }),
};

const field = {
  background: THEME.field,
  border: `1px solid ${THEME.textFaint}`,
  borderRadius: RADIUS.sm,
  padding: '11px 12px',
  fontSize: TYPE.body.size,
  color: THEME.text,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const label = {
  fontSize: TYPE.micro.size,
  letterSpacing: TYPE.micro.letterSpacing,
  color: THEME.muted,
  marginBottom: 4,
  display: 'block',
};

export default function ChangePasswordPanel() {
  const { t, i18n } = useLingui();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [cause, setCause] = useState(null);
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setCause(null);
    setDone(false);
    const result = await changePassword({ current, next, confirm });
    setBusy(false);
    if (!result.ok) {
      setCause(result.cause);
      return;
    }
    // Cleared, so the new password does not sit in the form.
    setCurrent('');
    setNext('');
    setConfirm('');
    setDone(true);
  };

  return (
    <form
      onSubmit={submit}
      style={{
        background: THEME.surface,
        border: `1px solid ${THEME.border}`,
        borderRadius: RADIUS.md,
        padding: `${SPACE.lg}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.md,
      }}
    >
      <div>
        <label style={label} htmlFor="pw-current">
          <Trans comment="Change-password field label, all capitals">
            CURRENT PASSWORD
          </Trans>
        </label>
        <input
          id="pw-current"
          style={field}
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div>
        <label style={label} htmlFor="pw-new">
          <Trans comment="Change-password field label, all capitals">
            NEW PASSWORD
          </Trans>
        </label>
        <input
          id="pw-new"
          style={field}
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </div>
      <div>
        <label style={label} htmlFor="pw-confirm">
          <Trans comment="Change-password field label, all capitals">
            REPEAT THE NEW PASSWORD
          </Trans>
        </label>
        <input
          id="pw-confirm"
          style={field}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {cause && (
        <div
          role="alert"
          style={{
            fontSize: TYPE.bodySm.size,
            lineHeight: TYPE.bodySm.lineHeight,
            color: THEME.critical,
          }}
        >
          {i18n._(CAUSE_TEXT[cause] ?? CAUSE_TEXT.failed, {
            min: MIN_PASSWORD,
          })}
        </div>
      )}
      {done && (
        <div
          role="status"
          style={{
            fontSize: TYPE.bodySm.size,
            lineHeight: TYPE.bodySm.lineHeight,
            color: THEME.positive,
          }}
        >
          <Trans comment="Change-password success message">
            Password changed.
          </Trans>
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        style={{
          minHeight: 44,
          border: `1px solid ${THEME.border}`,
          borderRadius: RADIUS.sm,
          background: busy ? THEME.border : THEME.raised,
          color: THEME.text,
          fontSize: TYPE.body.size,
          fontFamily: 'inherit',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy
          ? t({
              message: 'Changing…',
              comment: 'Change-password button while the request is out',
            })
          : t({
              message: 'Change password',
              comment: 'Change-password button',
            })}
      </button>
    </form>
  );
}
