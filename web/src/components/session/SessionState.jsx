import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { clockTime } from '../../utils/dateFormat.js';
import { unavailableCopy } from './sourceCopy.js';

const boxStyle = {
  background: THEME.raised,
  border: `1px solid ${THEME.border}`,
  borderRadius: RADIUS.md,
  padding: SPACE.lg,
  margin: `${SPACE.md}px 0`,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.body.weight,
  lineHeight: TYPE.body.lineHeight,
  color: THEME.text,
};

const actionStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  marginTop: SPACE.sm,
  padding: `0 ${SPACE.lg}px`,
  borderRadius: RADIUS.pill,
  border: `1px solid ${THEME.border}`,
  background: THEME.surface,
  color: THEME.text,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.label.weight,
  textDecoration: 'none',
  cursor: 'pointer',
};

// One message per page or trace state; none of them draws a chart.
//   kind: 'not_found' | 'wrong_sport' | 'detail_error' | 'none' |
//         'unavailable' (with reason) | 'error'
export default function SessionState({
  kind,
  reason = null,
  source = null,
  retryAt = null,
  onRetry = null,
}) {
  const { t, i18n } = useLingui();
  let text;
  let settings = false;
  let retry = false;
  if (kind === 'not_found') {
    text = t({
      message: 'There is no session with this id in your log.',
      comment: 'Session page: not found',
    });
  } else if (kind === 'wrong_sport') {
    text = t({
      message: 'Only completed rowing and cycling sessions open here.',
      comment: 'Session page: a strength or other session',
    });
  } else if (kind === 'detail_error') {
    text = t({
      message: 'The session could not be loaded.',
      comment: 'Session page: the row failed to load',
    });
    retry = true;
  } else if (kind === 'none') {
    text = t({
      message: 'This session has a summary only; no trace is linked to it.',
      comment: 'Session page: no series source',
    });
  } else if (kind === 'unavailable') {
    const copy = unavailableCopy(source, reason);
    const ms = retryAt ? Date.parse(retryAt) : NaN;
    text =
      reason === 'rate_limited' && copy.messageNoTime && !Number.isFinite(ms)
        ? i18n._(copy.messageNoTime)
        : i18n._(copy.message, {
            time: Number.isFinite(ms) ? clockTime(ms) : '',
          });
    settings = !!copy.settings;
  } else {
    text = t({
      message: 'The trace could not be loaded.',
      comment: 'Session page: network or server error',
    });
    retry = true;
  }
  return (
    <div role="status" style={boxStyle}>
      <p style={{ margin: 0 }}>{text}</p>
      {settings && (
        <a href="#/settings" style={actionStyle}>
          {t({ message: 'Settings', comment: 'Link to the Settings screen' })}
        </a>
      )}
      {retry && onRetry && (
        <button type="button" onClick={onRetry} style={actionStyle}>
          {t({ message: 'Retry', comment: 'Button: load again' })}
        </button>
      )}
    </div>
  );
}
