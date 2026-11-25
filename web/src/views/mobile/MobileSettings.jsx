import React, { useEffect, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import SettingsView from '../SettingsView.jsx';
import { supabase } from '../../supabaseClient.js';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import {
  readLiveErgFlag,
  writeLiveErgFlag,
} from '../../live-erg/liveErgFlag.js';
import VoiceCuesLabs from './VoiceCuesLabs.jsx';

// Beta opt-in for the v10 live screen (#768). Off by default; it only swaps
// the screen shown mid-piece, so connecting, the PM5 list, the summary and
// saving are unchanged either way.
function LiveErgLabs() {
  const [on, setOn] = useState(() => readLiveErgFlag());
  return (
    <section
      aria-labelledby="settings-labs"
      style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}
    >
      <h2
        id="settings-labs"
        style={{
          margin: 0,
          fontSize: TYPE.title.size,
          fontWeight: TYPE.title.weight,
          letterSpacing: TYPE.title.letterSpacing,
          color: THEME.textStrong,
        }}
      >
        <Trans comment="Settings section heading for features still being tested">
          Labs
        </Trans>
      </h2>
      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: SPACE.md,
          minHeight: 44,
          background: THEME.surface,
          border: `1px solid ${THEME.border}`,
          borderRadius: RADIUS.md,
          padding: `${SPACE.lg}px`,
          color: THEME.text,
          fontSize: TYPE.body.size,
          lineHeight: TYPE.body.lineHeight,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            if (writeLiveErgFlag(e.target.checked)) setOn(e.target.checked);
          }}
          style={{ width: 24, height: 24, margin: 0, flex: 'none' }}
        />
        <span>
          <span style={{ display: 'block', fontWeight: TYPE.label.weight }}>
            <Trans comment="Settings switch. Turns on the new live rowing screen, still in testing">
              New live screen (beta)
            </Trans>
          </span>
          <span style={{ display: 'block', color: THEME.muted }}>
            <Trans comment="Under the new live screen switch. PM5 is the rowing machine's monitor: keep it">
              While you row, show your intervals, watt targets and split table.
              Connecting to the PM5 and saving stay the same.
            </Trans>
          </span>
        </span>
      </label>
      <VoiceCuesLabs />
    </section>
  );
}

// Settings is a screen, not a destination: the four-tab IA (DESIGN_BRIEF §2.2)
// stays four, and this is reached from the top bar's Settings button on every
// destination. `returnLabel` is the translated name of the destination Back
// returns to. It hosts the desktop SettingsView unchanged, so Strava behaves
// identically on both.
export default function MobileSettings({ onBack, returnLabel, notice }) {
  const { t } = useLingui();
  const destination = returnLabel ?? t`Today`;
  // Focus moves to the heading on arrival, so a screen reader announces the
  // new screen instead of leaving focus on a button that no longer exists.
  const headingRef = useRef(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <div
      style={{
        padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.xl}px`,
        background: THEME.bg,
        minHeight: '100vh',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SPACE.xs,
          margin: `-${SPACE.md}px 0 ${SPACE.md}px -${SPACE.md}px`,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label={t({
            message: `Back to ${destination}`,
            comment: 'Settings back button; destination is a mobile tab name',
          })}
          style={{
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            color: THEME.text,
            cursor: 'pointer',
            padding: 0,
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
        </button>
        <h1
          ref={headingRef}
          tabIndex={-1}
          style={{
            outline: 'none',
            margin: 0,
            fontSize: TYPE.body.size,
            fontWeight: TYPE.label.weight,
            color: THEME.text,
          }}
        >
          <Trans>Settings</Trans>
        </h1>
      </header>
      <SettingsView notice={notice} heading={false} />
      <div style={{ marginTop: SPACE.lg }}>
        <LiveErgLabs />
      </div>
      <button
        type="button"
        onClick={() => supabase.auth.signOut()}
        style={{
          width: '100%',
          minHeight: 44,
          marginTop: SPACE.xl,
          border: `1px solid ${THEME.border}`,
          borderRadius: RADIUS.sm,
          background: THEME.surface,
          color: THEME.text,
          fontSize: TYPE.body.size,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <Trans>Sign out</Trans>
      </button>
    </div>
  );
}
