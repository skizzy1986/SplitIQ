import { useEffect, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import { clockTime } from '../../utils/dateFormat.js';
import { noTraceCopy, unavailableCopy } from './sourceCopy.js';

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

// The session whose page the athlete last followed a Settings link from. A
// connection problem is only worth retrying after that trip: before it, the
// same answer would come back. Module-level because the page unmounts while
// Settings is open; scoped to that one session, and spent by its Retry.
let settingsVisitedFrom = null;
export function resetSettingsVisited() {
  settingsVisitedFrom = null;
}

// One message per page or trace state; none of them draws a chart.
//   kind: 'not_found' | 'wrong_sport' | 'detail_error' | 'none' (reason
//         'no_trace' when the source answered with no trace) |
//         'unavailable' (with reason) | 'error'
//   sessionId: the session the page shows, for the Settings round trip
export default function SessionState({
  kind,
  sessionId = null,
  reason = null,
  source = null,
  retryAt = null,
  onRetry = null,
}) {
  const { t, i18n } = useLingui();
  const retryMs = retryAt ? Date.parse(retryAt) : NaN;
  const [now, setNow] = useState(() => Date.now());
  // Re-render once the retry time passes, so the button enables itself.
  useEffect(() => {
    if (!Number.isFinite(retryMs)) return undefined;
    const wait = retryMs - Date.now();
    if (wait <= 0) return undefined;
    const id = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(id);
  }, [retryMs]);
  let text;
  let settings = false;
  let retry = false;
  let retryDisabled = false;
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
  } else if (kind === 'none' && reason === 'no_trace') {
    text = i18n._(noTraceCopy(source));
  } else if (kind === 'none') {
    text = t({
      message: 'This session has a summary only; no trace is linked to it.',
      comment: 'Session page: no series source',
    });
  } else if (kind === 'unavailable') {
    const copy = unavailableCopy(source, reason);
    const timed = Number.isFinite(retryMs);
    text =
      copy.messageNoTime && !timed
        ? i18n._(copy.messageNoTime)
        : i18n._(copy.message, { time: timed ? clockTime(retryMs) : '' });
    settings = !!copy.settings;
    if (copy.retry === 'now') retry = true;
    if (copy.retry === 'after_settings') {
      retry = sessionId != null && settingsVisitedFrom === sessionId;
    }
    if (copy.retry === 'after_time') {
      retry = true;
      retryDisabled = timed && retryMs > now;
    }
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
        {settings && (
          <a
            href="#/settings"
            style={actionStyle}
            onClick={() => {
              settingsVisitedFrom = sessionId;
            }}
          >
            {t({ message: 'Settings', comment: 'Link to the Settings screen' })}
          </a>
        )}
        {retry && onRetry && (
          <button
            type="button"
            onClick={() => {
              if (settingsVisitedFrom === sessionId) settingsVisitedFrom = null;
              onRetry();
            }}
            disabled={retryDisabled}
            style={{
              ...actionStyle,
              cursor: retryDisabled ? 'default' : 'pointer',
              color: retryDisabled ? THEME.textFaint : THEME.text,
            }}
          >
            {t({ message: 'Retry', comment: 'Button: load again' })}
          </button>
        )}
      </div>
    </div>
  );
}
