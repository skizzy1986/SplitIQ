import { useSyncExternalStore, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { getCueRuntime } from '../services/cueRuntime.js';
import { readLiveErgFlag } from './liveErgFlag.js';
import { readCuesEnabled } from '../utils/cueSettings.js';

// In-session mute for the voice cues (#785). Shown only when the cues are on.
// It silences voice and tones until the session ends, then resets.
export default function CueMuteButton({ storage }) {
  const { t } = useLingui();
  const [on] = useState(
    () => readLiveErgFlag(storage) && readCuesEnabled(storage)
  );
  const { player } = getCueRuntime();
  const muted = useSyncExternalStore(player.subscribe, player.isMuted);
  if (!on) return null;
  return (
    <button
      type="button"
      data-testid="cue-mute"
      aria-pressed={muted}
      aria-label={muted ? t`Unmute voice cues` : t`Mute voice cues`}
      onClick={() => player.setMuted(!muted)}
      style={{
        minWidth: 44,
        minHeight: 44,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACE.xs,
        padding: `0 ${SPACE.sm}px`,
        border: `1px solid ${THEME.border}`,
        borderRadius: RADIUS.pill,
        background: muted ? THEME.raised : THEME.surface,
        color: muted ? THEME.muted : THEME.text,
        fontSize: TYPE.label.size,
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
        <path d="M4 9v6h4l5 4V5L8 9H4z" />
        {muted ? (
          <path d="M17 9l5 6M22 9l-5 6" />
        ) : (
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
        )}
      </svg>
    </button>
  );
}
