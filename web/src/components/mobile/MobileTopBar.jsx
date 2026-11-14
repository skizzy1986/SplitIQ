import React, { useEffect } from 'react';
import { Trans } from '@lingui/react/macro';
import { THEME } from '../../constants/theme.js';
import { SPACE, TYPE } from '../../constants/tokens.js';

const GEAR_PATH =
  'M18.7 9.8L20.9 10.4L20.9 13.6L18.7 14.2L18.2 15.2L19.4 17.1L17.1 19.4L15.2 18.2L14.2 18.7L13.6 20.9L10.4 20.9L9.8 18.7L8.8 18.2L6.9 19.4L4.6 17.1L5.8 15.2L5.3 14.2L3.1 13.6L3.1 10.4L5.3 9.8L5.8 8.8L4.6 6.9L6.9 4.6L8.8 5.8L9.8 5.3L10.4 3.1L13.6 3.1L14.2 5.3L15.2 5.8L17.1 4.6L19.4 6.9L18.2 8.8Z';

// The same bar on every destination, so Settings (and the language control in
// it) is one labelled tap from anywhere. A bare gear on Today alone was not
// found. `focusSettings` puts focus back on the button after returning from
// Settings by Back.
export default function MobileTopBar({
  onOpenSettings,
  settingsRef,
  focusSettings = false,
}) {
  useEffect(() => {
    if (focusSettings) settingsRef?.current?.focus();
  }, [focusSettings, settingsRef]);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `calc(${SPACE.xs}px + env(safe-area-inset-top, 0px)) ${SPACE.xs}px 0 ${SPACE.lg}px`,
        background: THEME.bg,
      }}
    >
      <span
        style={{
          fontSize: TYPE.body.size,
          fontWeight: TYPE.label.weight,
          color: THEME.text,
        }}
      >
        SPLITIQ
      </span>
      <button
        ref={settingsRef}
        type="button"
        onClick={onOpenSettings}
        style={{
          minWidth: 44,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: SPACE.xs,
          padding: `0 ${SPACE.md}px`,
          border: 'none',
          background: 'transparent',
          color: THEME.textSubtle,
          fontSize: TYPE.bodySm.size,
          fontWeight: TYPE.label.weight,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={GEAR_PATH} />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <Trans comment="Mobile top bar button that opens Settings">
          Settings
        </Trans>
      </button>
    </header>
  );
}
