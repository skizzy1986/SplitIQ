import { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import Button from '../../components/Button.jsx';
import { THEME } from '../../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../../constants/tokens.js';
import { unlockCueAudio } from '../../services/cueAudio.js';
import {
  readCueVoice,
  readCuesEnabled,
  writeCueVoice,
  writeCuesEnabled,
} from '../../utils/cueSettings.js';

const card = {
  display: 'flex',
  flexDirection: 'column',
  gap: SPACE.md,
  background: THEME.surface,
  border: `1px solid ${THEME.border}`,
  borderRadius: RADIUS.md,
  padding: `${SPACE.lg}px`,
  color: THEME.text,
  fontSize: TYPE.body.size,
  lineHeight: TYPE.body.lineHeight,
};

const mutedText = { display: 'block', color: THEME.muted };

// Beta switch, voice choice and a test cue for the live screen's spoken cues
// (#785). Off by default. The clips are English whatever language the app is
// in. The test cue is how to find out, on a real phone, whether playing a cue
// pauses the music app (Spotify), so start the music first.
export default function VoiceCuesLabs({ storage }) {
  const { t } = useLingui();
  const [on, setOn] = useState(() => readCuesEnabled(storage));
  const [voice, setVoice] = useState(() => readCueVoice(storage));
  // idle | playing | played | failed
  const [test, setTest] = useState('idle');

  const voices = [
    { key: 'dry', label: t`Dry` },
    { key: 'encouraging', label: t`Encouraging` },
    { key: 'technical', label: t`Technical` },
  ];

  async function playTest() {
    // The audio context may only start inside this tap.
    unlockCueAudio();
    setTest('playing');
    try {
      const rt = await import('../../services/cueRuntime.js');
      const result = await rt.playLifecycle('test', voice);
      setTest(result === 'started' ? 'played' : 'failed');
    } catch {
      // The player has already reported what went wrong; say so on screen.
      setTest('failed');
    }
  }

  return (
    <div style={card}>
      <label
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: SPACE.md,
          minHeight: 44,
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            if (writeCuesEnabled(e.target.checked, storage))
              setOn(e.target.checked);
          }}
          style={{ width: 24, height: 24, margin: 0, flex: 'none' }}
        />
        <span>
          <span style={{ display: 'block', fontWeight: TYPE.label.weight }}>
            <Trans comment="Settings switch. Turns on spoken coaching cues on the new live rowing screen, still in testing">
              Voice cues (beta)
            </Trans>
          </span>
          <span style={mutedText}>
            <Trans comment="Under the voice cues switch. The cues are recorded in English and stay English in Spanish. Needs the new live screen">
              Short spoken cues while you row: go, targets, hit or miss, rest
              and finish. They only work with the new live screen on, and the
              clips are in English.
            </Trans>
          </span>
        </span>
      </label>

      <div
        role="radiogroup"
        aria-label={t`Cue voice`}
        style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}
      >
        {voices.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={voice === key}
            onClick={() => {
              if (writeCueVoice(key, storage)) setVoice(key);
            }}
            style={{
              minHeight: 44,
              padding: `0 ${SPACE.lg}px`,
              borderRadius: RADIUS.pill,
              border: `1px solid ${voice === key ? THEME.accent : THEME.border}`,
              background: voice === key ? THEME.accent : THEME.raised,
              color: voice === key ? THEME.onAccent : THEME.text,
              fontSize: TYPE.body.size,
              fontWeight: TYPE.label.weight,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <Button onClick={playTest} disabled={test === 'playing'}>
          <Trans comment="Settings button. Plays one short test cue so you can hear it and check what it does to your music">
            Play a test cue
          </Trans>
        </Button>
        <span
          aria-live="polite"
          style={{ ...mutedText, marginTop: SPACE.sm, minHeight: 20 }}
        >
          {test === 'played' && t`Played. Did your music keep going?`}
          {test === 'failed' && t`Couldn't play the cue. Try again.`}
        </span>
        <span style={{ ...mutedText, marginTop: SPACE.xs }}>
          <Trans comment="Under the test cue button. Spotify is a music app: keep the name">
            Start your music first, then tap. Note whether Spotify pauses,
            lowers or keeps playing.
          </Trans>
        </span>
      </div>
    </div>
  );
}
