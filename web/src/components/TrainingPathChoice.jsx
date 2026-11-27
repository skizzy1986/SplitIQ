import { Trans } from '@lingui/react/macro';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import {
  HR_PATH_RPE,
  HR_PATH_STRAP,
  pathForChoice,
} from '../utils/trainingSettings.js';

const choiceStyle = (on, disabled) => ({
  width: '100%',
  minHeight: 44,
  padding: `0 ${SPACE.lg}px`,
  borderRadius: RADIUS.md,
  border: `1px solid ${on ? THEME.accent : THEME.border}`,
  background: on ? THEME.raised : THEME.surface,
  color: THEME.text,
  fontFamily: FONT.sans,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.label.weight,
  textAlign: 'left',
  cursor: disabled ? 'default' : 'pointer',
});

// The strap-or-no-strap choice (#819, H 6, 7, 9). Props in, nothing fetched.
// `value` is the stored path, or null when the account has not chosen: nothing
// is selected then, and the default is applied only when the user skips
// (`onSkip`, which the caller stores as the RPE path). Passing no `onSkip`
// hides the skip button, which is how Settings uses it. The text names no
// brand, links nowhere and does not say what to buy.
export default function TrainingPathChoice({
  value = null,
  onChoose,
  onSkip,
  disabled = false,
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.md,
        fontFamily: FONT.sans,
      }}
    >
      <p
        style={{
          margin: 0,
          color: THEME.text,
          fontSize: TYPE.body.size,
          lineHeight: TYPE.body.lineHeight,
        }}
      >
        <Trans comment="Strap choice. Plain words, no brand, no shop. A wrist watch does not count as a strap.">
          Training is easier with a heart-rate chest strap or an optical arm
          band. A wrist watch does not count here. If a watch is all you have,
          choose the second option.
        </Trans>
      </p>
      <button
        type="button"
        aria-pressed={value === HR_PATH_STRAP}
        disabled={disabled}
        onClick={() => onChoose(pathForChoice(true))}
        style={choiceStyle(value === HR_PATH_STRAP, disabled)}
      >
        <Trans comment="Button: the user has a heart-rate strap or arm band">
          I have a strap or arm band
        </Trans>
      </button>
      <button
        type="button"
        aria-pressed={value === HR_PATH_RPE}
        disabled={disabled}
        onClick={() => onChoose(pathForChoice(false))}
        style={choiceStyle(value === HR_PATH_RPE, disabled)}
      >
        <Trans comment="Button: the user has no heart-rate strap or arm band">
          I don&apos;t have one
        </Trans>
      </button>
      {onSkip && (
        <button
          type="button"
          disabled={disabled}
          onClick={onSkip}
          style={{
            minHeight: 44,
            border: 'none',
            background: 'transparent',
            color: THEME.muted,
            fontFamily: FONT.sans,
            fontSize: TYPE.body.size,
            cursor: disabled ? 'default' : 'pointer',
            textDecoration: 'underline',
          }}
        >
          <Trans comment="Button: skip the strap question and go by effort. Skipping is the same as having no strap.">
            Skip, and go by effort
          </Trans>
        </button>
      )}
    </div>
  );
}
