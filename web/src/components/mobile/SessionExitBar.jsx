import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { FONT } from '../../constants/type.js';
import Button from '../Button.jsx';

// The way out of a session on phone. A live session hides the tab bar
// (HANDOFF.md §4), so without this the only exit was the Android back button,
// which a browser tab does not route to the app. `confirm`, when set, is the
// sentence shown before leaving: something on screen would be lost.
export default function SessionExitBar({ onExit, confirm = null }) {
  const [asking, setAsking] = useState(false);
  // The risk can pass while the question is open (a save settles); then the
  // question no longer applies and Back leaves directly again.
  if (asking && !confirm) setAsking(false);

  if (asking) {
    return (
      <div
        role="alertdialog"
        aria-labelledby="session-exit-question"
        style={{
          margin: SPACE.md,
          padding: SPACE.md,
          background: THEME.surface,
          border: `1px solid ${THEME.border}`,
          borderRadius: RADIUS.md,
          fontFamily: FONT.sans,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACE.sm,
        }}
      >
        <div
          id="session-exit-question"
          style={{ fontSize: TYPE.body.size, color: THEME.text }}
        >
          {confirm}
        </div>
        <div style={{ display: 'flex', gap: SPACE.sm }}>
          <Button onClick={() => setAsking(false)}>
            <Trans comment="Cancel leaving a live session">Stay</Trans>
          </Button>
          <Button variant="primary" onClick={onExit}>
            <Trans comment="Confirm leaving a live session">Leave</Trans>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => (confirm ? setAsking(true) : onExit())}
        style={{
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: SPACE.xs,
          padding: `0 ${SPACE.md}px 0 ${SPACE.sm}px`,
          border: 'none',
          background: 'transparent',
          color: THEME.textSubtle,
          fontFamily: FONT.sans,
          fontSize: TYPE.body.size,
          fontWeight: TYPE.label.weight,
          cursor: 'pointer',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 5l-7 7 7 7" />
        </svg>
        <Trans comment="Leave a live session for the Train start screen">
          Back to Train
        </Trans>
      </button>
    </div>
  );
}
