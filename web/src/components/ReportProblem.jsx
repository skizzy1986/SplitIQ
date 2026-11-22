import { useId, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { version } from '../../package.json';
import { supabase } from '../supabaseClient.js';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import Button from './Button.jsx';
import {
  currentScreen,
  readPlatform,
  sendProblemReport,
} from '../utils/reportProblem.js';

const fieldStyle = {
  background: THEME.field,
  border: `1px solid ${THEME.border}`,
  borderRadius: RADIUS.sm,
  padding: SPACE.md,
  color: THEME.text,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  lineHeight: TYPE.body.lineHeight,
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
};

const labelStyle = {
  fontSize: TYPE.bodySm.size,
  fontWeight: TYPE.label.weight,
  color: THEME.textSubtle,
};

export default function ReportProblem() {
  const whatId = useId();
  const stepsId = useId();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState('');
  const [steps, setSteps] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (!what.trim()) {
      setNotice({ tone: 'critical', text: 'missing' });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user?.id) throw new Error('delivery failed');
      await sendProblemReport(supabase, {
        what,
        steps,
        version,
        route: currentScreen(window.location),
        platform: readPlatform(),
        userId: data.user.id,
      });
      setWhat('');
      setSteps('');
      setNotice({ tone: 'positive', text: 'sent' });
    } catch (err) {
      setNotice({
        tone: 'critical',
        text: err?.status === 429 ? 'limited' : 'failed',
      });
    } finally {
      setPending(false);
    }
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Trans>Report a problem</Trans>
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.sm,
        background: THEME.surface,
        border: `1px solid ${THEME.border}`,
        borderRadius: RADIUS.md,
        padding: SPACE.lg,
      }}
    >
      <label htmlFor={whatId} style={labelStyle}>
        <Trans>What happened</Trans>
      </label>
      <textarea
        id={whatId}
        value={what}
        maxLength={2000}
        onChange={(event) => setWhat(event.target.value)}
        style={{ ...fieldStyle, minHeight: 88 }}
      />
      <label htmlFor={stepsId} style={labelStyle}>
        <Trans>Steps (optional)</Trans>
      </label>
      <textarea
        id={stepsId}
        value={steps}
        maxLength={2000}
        onChange={(event) => setSteps(event.target.value)}
        style={{ ...fieldStyle, minHeight: 72 }}
      />
      {notice && (
        <p
          role="status"
          style={{
            margin: 0,
            color: THEME[notice.tone] ?? THEME.text,
            fontSize: TYPE.bodySm.size,
            lineHeight: TYPE.bodySm.lineHeight,
          }}
        >
          {notice.text === 'sent' && <Trans>Sent. Thank you.</Trans>}
          {notice.text === 'missing' && <Trans>Describe what happened.</Trans>}
          {notice.text === 'limited' && (
            <Trans>Too many reports. Try again shortly.</Trans>
          )}
          {notice.text === 'failed' && (
            <Trans>Could not send the report. Try again.</Trans>
          )}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        <Trans>Send report</Trans>
      </Button>
    </form>
  );
}
