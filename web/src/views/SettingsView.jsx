import React, { lazy, Suspense } from 'react';
import StravaConnectPanel from '../components/StravaConnectPanel.jsx';
import LanguageToggle from '../components/LanguageToggle.jsx';
import ThemeControl from '../components/ThemeControl.jsx';
import { Trans, useLingui } from '@lingui/react/macro';
import { THEME } from '../constants/theme.js';
import ScreenHeader from '../components/ScreenHeader.jsx';
import TrainingSettingsSection from './TrainingSettingsSection.jsx';
import AdvancedSettingsSection from './AdvancedSettingsSection.jsx';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { APP_BUILD } from '../utils/appBuild.js';
import { isTestersBuild } from '../utils/testersBuild.js';

// Testers only (#792), and its own chunk, so the owner's Settings never loads it.
const ChangePasswordPanel = lazy(
  () => import('../components/ChangePasswordPanel.jsx')
);

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.sm,
};

const headingStyle = {
  margin: 0,
  fontSize: TYPE.title.size,
  fontWeight: TYPE.title.weight,
  letterSpacing: TYPE.title.letterSpacing,
  color: THEME.textStrong,
};

// Deliberately thin. Strava is the first integration to need a home; Garmin,
// Concept2 and the rest land here as sibling panels rather than growing another
// tab each.
export default function SettingsView({ onSynced, notice, heading = true }) {
  const { t } = useLingui();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.lg,
        fontFamily: FONT.sans,
      }}
    >
      {heading && <ScreenHeader title={<Trans>Settings</Trans>} />}
      <div
        style={{
          fontSize: TYPE.micro.size,
          fontWeight: TYPE.micro.weight,
          letterSpacing: TYPE.micro.letterSpacing,
          color: THEME.accent,
        }}
      >
        <Trans comment="Section eyebrow, all capitals">SETTINGS</Trans>
      </div>
      {/* The OAuth outcome, routed here by App.jsx's callback effect. */}
      {notice && (
        <div
          role="status"
          style={{
            border: `1px solid ${THEME[notice.tone] ?? THEME.border}`,
            borderRadius: RADIUS.sm,
            padding: `${SPACE.md}px`,
            color: THEME[notice.tone] ?? THEME.text,
            fontSize: TYPE.bodySm.size,
            lineHeight: TYPE.bodySm.lineHeight,
          }}
        >
          {notice.text}
        </div>
      )}
      <section aria-labelledby="settings-theme" style={sectionStyle}>
        <h2 id="settings-theme" style={headingStyle}>
          <Trans>Theme</Trans>
        </h2>
        <ThemeControl />
      </section>
      <section aria-labelledby="settings-language" style={sectionStyle}>
        <h2 id="settings-language" style={headingStyle}>
          <Trans comment="Settings section heading above the language control">
            Language
          </Trans>
        </h2>
        <div
          style={{
            background: THEME.surface,
            border: `1px solid ${THEME.border}`,
            borderRadius: RADIUS.md,
            padding: `${SPACE.lg}px`,
          }}
        >
          <LanguageToggle />
        </div>
      </section>
      <TrainingSettingsSection />
      <AdvancedSettingsSection />
      {isTestersBuild() && (
        <section aria-labelledby="settings-password" style={sectionStyle}>
          <h2 id="settings-password" style={headingStyle}>
            <Trans comment="Settings section heading above the change-password form">
              Password
            </Trans>
          </h2>
          <Suspense fallback={null}>
            <ChangePasswordPanel />
          </Suspense>
        </section>
      )}
      {/* Strava is the owner's own account: not on a testers build (#793). */}
      {!isTestersBuild() && (
        <section aria-labelledby="settings-integrations" style={sectionStyle}>
          <h2 id="settings-integrations" style={headingStyle}>
            <Trans comment="Settings section heading above the Strava panel">
              Integrations
            </Trans>
          </h2>
          <StravaConnectPanel onSynced={onSynced} />
        </section>
      )}
      <section aria-labelledby="settings-about" style={sectionStyle}>
        <h2 id="settings-about" style={headingStyle}>
          <Trans comment="Settings section heading for the app version">
            About
          </Trans>
        </h2>
        <p
          aria-label={t({
            message: `Build ${APP_BUILD}`,
            comment:
              'Accessible label for the build identifier in Settings. Same identifier as the loading screen.',
          })}
          style={{
            margin: 0,
            background: THEME.surface,
            border: `1px solid ${THEME.border}`,
            borderRadius: RADIUS.md,
            padding: `${SPACE.lg}px`,
            color: THEME.muted,
            fontFamily: FONT.mono,
            fontSize: TYPE.body.size,
            fontWeight: TYPE.body.weight,
            lineHeight: TYPE.body.lineHeight,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Trans comment="Settings About line. The identifier is the current app build.">
            Build {APP_BUILD}
          </Trans>
        </p>
      </section>
    </div>
  );
}
