import { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { version } from '../../package.json';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { useReportProblem } from '../hooks/useReportProblem.js';
import { currentScreen, readClientPlatform } from '../utils/reportContext.js';

const fieldStyle = {
  background: THEME.field,
  border: `1px solid ${THEME.border}`,
  borderRadius: RADIUS.sm,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  fontSize: TYPE.body.size,
  lineHeight: TYPE.body.lineHeight,
  color: THEME.text,
  fontFamily: FONT.sans,
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle = {
  fontSize: TYPE.label.size,
  fontWeight: TYPE.label.weight,
  letterSpacing: TYPE.label.letterSpacing,
  color: THEME.textSubtle,
};

function Action({ children, onClick, disabled, primary, expanded }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={expanded}
      style={{
        minHeight: 44,
        padding: `0 ${SPACE.lg}px`,
        borderRadius: RADIUS.sm,
        border: `1px solid ${primary ? THEME.accent : THEME.border}`,
        background: primary ? THEME.accent : THEME.surface,
        color: primary ? THEME.bg : THEME.text,
        fontFamily: FONT.sans,
        fontSize: TYPE.body.size,
        fontWeight: TYPE.label.weight,
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export default function ReportProblem() {
  const report = useReportProblem();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState('');
  const [steps, setSteps] = useState('');
  const [notice, setNotice] = useState(null);

  const close = () => {
    setOpen(false);
    setNotice(null);
  };

  const send = () => {
    const happened = what.trim();
    if (!happened) {
      setNotice('need');
      return;
    }
    setNotice(null);
    report.mutate(
      {
        what: happened,
        steps: steps.trim() || null,
        version,
        route: currentScreen(window.location),
        platform: readClientPlatform(),
      },
      {
        onSuccess: () => {
          setWhat('');
          setSteps('');
          setNotice('sent');
        },
        onError: (error) => {
          setNotice(error.code === 'rate_limited' ? 'limited' : 'failed');
        },
      }
    );
  };

  if (!open) {
    return (
      <Action onClick={() => setOpen(true)} expanded={false}>
        <Trans>Report a problem</Trans>
      </Action>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
      <label htmlFor="report-what" style={labelStyle}>
        <Trans>What happened</Trans>
      </label>
      <p
        style={{
          margin: 0,
          fontSize: TYPE.bodySm.size,
          lineHeight: TYPE.bodySm.lineHeight,
          color: THEME.textSubtle,
        }}
      >
        <Trans>Describe what went wrong.</Trans>
      </p>
      <textarea
        id="report-what"
        value={what}
        maxLength={2000}
        rows={4}
        onChange={(e) => setWhat(e.target.value)}
        style={fieldStyle}
      />
      <label htmlFor="report-steps" style={labelStyle}>
        <Trans>Steps (optional)</Trans>
      </label>
      <p
        style={{
          margin: 0,
          fontSize: TYPE.bodySm.size,
          lineHeight: TYPE.bodySm.lineHeight,
          color: THEME.textSubtle,
        }}
      >
        <Trans>What you did just before, if you remember.</Trans>
      </p>
      <textarea
        id="report-steps"
        value={steps}
        maxLength={2000}
        rows={3}
        onChange={(e) => setSteps(e.target.value)}
        style={fieldStyle}
      />
      <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
        <Action onClick={send} disabled={report.isPending} primary>
          {report.isPending ? (
            <Trans>Sending…</Trans>
          ) : (
            <Trans>Send report</Trans>
          )}
        </Action>
        <Action onClick={close} disabled={report.isPending}>
          <Trans>Cancel</Trans>
        </Action>
      </div>
      {notice && (
        <p
          role="status"
          style={{
            margin: 0,
            color: THEME.text,
            fontSize: TYPE.bodySm.size,
          }}
        >
          {notice === 'sent' && <Trans>Report sent. Thank you.</Trans>}
          {notice === 'need' && (
            <Trans>Describe what happened before sending.</Trans>
          )}
          {notice === 'limited' && (
            <Trans>Too many reports in a short time. Try again later.</Trans>
          )}
          {notice === 'failed' && (
            <Trans>Could not send the report. Try again shortly.</Trans>
          )}
        </p>
      )}
    </div>
  );
}
