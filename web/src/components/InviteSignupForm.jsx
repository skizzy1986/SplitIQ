import { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { NOTICE_APPROVED, noticeFor } from '../constants/testerNotice.js';
import { submitInviteSignup, MIN_PASSWORD } from '../utils/inviteSignup.js';

// The testers' way in (#791): an invite code, their email, a password they
// choose, and the notice with its consent tick. Shown only on a testers build
// (AuthGate decides), and loaded only when the link is pressed.

const CAUSE_TEXT = {
  invalid: msg({
    message:
      'That code and email did not work. Check them, or ask whoever invited you for a new code.',
    comment: 'Invite sign-up error. Deliberately says nothing more specific.',
  }),
  weak_password: msg({
    message: 'Choose a longer password: at least 8 characters.',
    comment: 'Invite sign-up error.',
  }),
  consent_required: msg({
    message: 'Tick the box to carry on.',
    comment: 'Invite sign-up error, when the consent tick is empty.',
  }),
  rate_limited: msg({
    message: 'Too many attempts. Wait a few minutes and try again.',
    comment: 'Invite sign-up error.',
  }),
  bad_request: msg({
    message: 'Check the email and the code and try again.',
    comment: 'Invite sign-up error, for a malformed email or code.',
  }),
  missing: msg({
    message: 'Fill in every field.',
    comment: 'Invite sign-up error.',
  }),
  mismatch: msg({
    message: "The two passwords don't match.",
    comment: 'Invite sign-up error.',
  }),
  network: msg({
    message: 'Could not reach the server. Check your connection and try again.',
    comment: 'Invite sign-up error when the device is offline.',
  }),
  fallback: msg({
    message: "Sign-up isn't available right now. Message whoever invited you.",
    comment: 'Invite sign-up error for any other cause.',
  }),
};

const inp = {
  background: THEME.field,
  border: `1px solid ${THEME.textFaint}`,
  borderRadius: 5,
  padding: '11px 12px',
  fontSize: 14,
  color: THEME.text,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const lbl = {
  fontSize: 9,
  letterSpacing: 1,
  color: THEME.muted,
  marginBottom: 4,
  display: 'block',
};

export default function InviteSignupForm({ onBack }) {
  const { t, i18n } = useLingui();
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  // The cause, not its text, so a language switch re-reads it.
  const [cause, setCause] = useState(null);
  const notice = noticeFor(i18n.locale);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setCause(null);
    const result = await submitInviteSignup({
      email,
      password,
      confirm,
      code,
      consent,
    });
    setBusy(false);
    if (!result.ok) {
      setCause(result.cause);
      return;
    }
    // Signed in: onAuthStateChange in AuthGate swaps the view. If the sign-in
    // itself failed the account still exists, so send them to the login form.
    if (!result.signedIn) onBack();
  };

  const causeText = cause ? t(CAUSE_TEXT[cause] ?? CAUSE_TEXT.fallback) : null;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: THEME.bg,
        fontFamily: FONT.sans,
        padding: 20,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 360,
          background: THEME.raised,
          border: `1px solid ${THEME.border}`,
          borderRadius: 10,
          padding: '26px 22px',
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: THEME.positive,
            letterSpacing: 1,
            marginBottom: 4,
          }}
        >
          SPLITIQ
        </div>
        <div style={{ fontSize: 11, color: THEME.muted, marginBottom: 22 }}>
          <Trans comment="Heading on the invite sign-up form">
            Create your test account
          </Trans>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl} htmlFor="invite-code">
            <Trans comment="Invite form field label, all capitals">
              INVITE CODE
            </Trans>
          </label>
          <input
            id="invite-code"
            style={{ ...inp, fontFamily: FONT.mono, letterSpacing: 1 }}
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl} htmlFor="invite-email">
            <Trans comment="Login form field label, all capitals">EMAIL</Trans>
          </label>
          <input
            id="invite-email"
            style={inp}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={lbl} htmlFor="invite-password">
            <Trans comment="Invite form field label, all capitals">
              CHOOSE A PASSWORD
            </Trans>
          </label>
          <input
            id="invite-password"
            style={inp}
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={lbl} htmlFor="invite-confirm">
            <Trans comment="Invite form field label, all capitals">
              REPEAT THE PASSWORD
            </Trans>
          </label>
          <input
            id="invite-confirm"
            style={inp}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <section
          aria-label={notice.title}
          style={{
            border: `1px solid ${THEME.border}`,
            borderRadius: 6,
            padding: '12px 12px 4px',
            marginBottom: 12,
            maxHeight: 240,
            overflowY: 'auto',
            fontSize: 11,
            lineHeight: 1.5,
            color: THEME.text,
          }}
        >
          {!NOTICE_APPROVED && (
            <div
              role="note"
              style={{
                color: THEME.critical,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              {notice.draft}
            </div>
          )}
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{notice.title}</div>
          {notice.paragraphs.map((p) => (
            <p key={p} style={{ margin: '0 0 8px' }}>
              {p}
            </p>
          ))}
        </section>
        <label
          htmlFor="invite-consent"
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-start',
            fontSize: 12,
            color: THEME.text,
            marginBottom: 14,
          }}
        >
          <input
            id="invite-consent"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>{notice.consent}</span>
        </label>

        {causeText && (
          <div
            role="alert"
            style={{
              fontSize: 11,
              color: THEME.critical,
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            {causeText}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%',
            background: busy ? THEME.border : THEME.positive,
            border: 'none',
            borderRadius: 6,
            padding: '12px',
            fontSize: 13,
            fontWeight: 700,
            color: THEME.surface,
            cursor: busy ? 'default' : 'pointer',
            fontFamily: 'inherit',
            letterSpacing: 1,
          }}
        >
          {busy
            ? t({
                message: 'CREATING…',
                comment: 'Invite sign-up button while the request is in flight',
              })
            : t({
                message: 'CREATE ACCOUNT',
                comment: 'Invite sign-up button',
              })}
        </button>
        <button
          type="button"
          onClick={onBack}
          style={{
            width: '100%',
            marginTop: 10,
            background: 'none',
            border: 'none',
            padding: 6,
            fontSize: 11,
            color: THEME.muted,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Trans comment="Link back to the sign-in form from the invite form">
            Back to sign in
          </Trans>
        </button>
      </form>
    </div>
  );
}
