import { useContext } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { ThemeContext, useTheme } from '../hooks/useTheme.js';
import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';

export default function ThemeControl() {
  const theme = useContext(ThemeContext);
  return theme ? <ThemeButtons {...theme} /> : <StandaloneThemeControl />;
}

function StandaloneThemeControl() {
  return <ThemeButtons {...useTheme()} />;
}

function ThemeButtons({ preference, setPreference }) {
  const { t } = useLingui();
  return (
    <div
      role="group"
      aria-label={t`Theme`}
      style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}
    >
      {[
        ['light', <Trans key="light">Light</Trans>],
        ['dark', <Trans key="dark">Dark</Trans>],
        ['system', <Trans key="system">Auto</Trans>],
      ].map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          onClick={() => setPreference(value)}
          style={{
            minHeight: 44,
            minWidth: 44,
            padding: `0 ${SPACE.md}px`,
            border: `1px solid ${preference === value ? THEME.accent : THEME.border}`,
            borderRadius: RADIUS.sm,
            background: THEME.surface,
            color: preference === value ? THEME.accent : THEME.text,
            fontFamily: 'inherit',
            fontSize: TYPE.body.size,
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
