import React, { useMemo } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import ErgLiveView from '../ErgLiveView.jsx';
import StrengthLogger from '../../StrengthLogger.jsx';
import { THEME } from '../../constants/theme.js';
import SessionExitBar from '../../components/mobile/SessionExitBar.jsx';
import ScreenHeader from '../../components/ScreenHeader.jsx';
import { FONT } from '../../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { useSessions } from '../../hooks/useSessions.js';
import { PLANNED_STATUS } from '../../constants/sessionStatus.js';
import { readLiveErgFlag } from '../../live-erg/liveErgFlag.js';

// Train is the doing: the session in front of you. It absorbs what were the
// separate "Live" and "Strength" tabs — DESIGN_BRIEF.md §2.2.
//
// Today's planned session, when it exists, is started from Today. This
// screen's always-on entries are Erg and Strength. With the v10 live screen
// on, Plan a session sits next to Erg so a workout can be built before the
// PM5 is in range.
const ENTRIES = [
  {
    mode: 'erg',
    label: 'Erg session',
    detail: 'Connect the PM5 and row against a watt band',
    token: 'accent',
  },
  {
    mode: 'strength',
    label: 'Strength session',
    detail: 'Log sets against today’s template',
    token: 'accentAlt',
  },
];

// What each entry says on screen; ENTRIES keeps its English for code and tests.
export const ENTRY_MESSAGES = {
  erg: {
    label: msg({ message: 'Erg session', comment: 'Start a rowing session' }),
    detail: msg`Connect the PM5 and row against a watt band`,
  },
  plan: {
    label: msg({
      message: 'Plan a session',
      comment: 'Build an interval workout before connecting the PM5',
    }),
    detail: msg`Build your intervals now, no PM5 needed`,
  },
  strength: {
    label: msg({
      message: 'Strength session',
      comment: 'Start a strength session',
    }),
    detail: msg`Log sets against today’s template`,
  },
};

// Not in ENTRIES: it only exists while the v10 live screen is on.
const PLAN_ENTRY = {
  mode: 'plan',
  label: 'Plan a session',
  detail: 'Build your intervals now, no PM5 needed',
  token: 'accent',
};

export { ENTRIES, PLAN_ENTRY };

export default function MobileTrain({ mode, onMode, planExitTo = 'train' }) {
  const { i18n } = useLingui();
  const { data: sessions } = useSessions({ mode: 'all' });
  // Minimal shape for ErgLiveView — don't pull sessionLog.js into the
  // MobileApp chunk just to pick today's planned erg.
  const plannedSessions = useMemo(
    () =>
      (sessions ?? [])
        .filter((row) => row.status === PLANNED_STATUS && row.type !== 'Test')
        .map((row) => ({
          ...row,
          _isErg: (row.type || '').toLowerCase() === 'erg',
        })),
    [sessions]
  );
  // A live session owns the screen — no tab bar, no chrome (HANDOFF.md §4) —
  // but always with a way back to this screen. Erg asks first when leaving
  // would drop a connection or an unsaved piece; strength keeps its own draft,
  // so leaving it loses nothing.
  if (mode === 'erg')
    return (
      <ErgLiveView
        onExit={() => onMode(null)}
        plannedSessions={plannedSessions}
      />
    );
  if (mode === 'plan')
    return (
      <ErgLiveView
        onExit={() => onMode(null)}
        plannedSessions={plannedSessions}
        exitTo={planExitTo}
      />
    );
  if (mode === 'strength')
    return (
      <>
        <SessionExitBar onExit={() => onMode(null)} />
        <StrengthLogger />
      </>
    );

  return (
    <div
      style={{
        padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.xl}px`,
        background: THEME.bg,
        minHeight: '100vh',
      }}
    >
      <ScreenHeader
        title={<Trans comment="Heading, all capitals">START A SESSION</Trans>}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
        {(readLiveErgFlag()
          ? [ENTRIES[0], PLAN_ENTRY, ENTRIES[1]]
          : ENTRIES
        ).map((e) => (
          <button
            key={e.mode}
            onClick={() => onMode(e.mode)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              background: THEME.surface,
              border: `1px solid ${THEME.border}`,
              borderLeft: `3px solid ${THEME[e.token]}`,
              borderRadius: RADIUS.md,
              padding: `${SPACE.lg}px`,
              cursor: 'pointer',
              fontFamily: FONT.sans,
            }}
          >
            <div
              style={{
                fontSize: TYPE.title.size,
                fontWeight: TYPE.title.weight,
                letterSpacing: TYPE.title.letterSpacing,
                color: THEME.text,
              }}
            >
              {i18n._(ENTRY_MESSAGES[e.mode].label)}
            </div>
            <div
              style={{
                fontSize: TYPE.bodySm.size,
                fontWeight: TYPE.bodySm.weight,
                color: THEME.muted,
                marginTop: SPACE.xs,
              }}
            >
              {i18n._(ENTRY_MESSAGES[e.mode].detail)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
