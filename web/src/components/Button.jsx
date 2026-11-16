import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';

export default function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  type = 'button',
}) {
  const primary = variant === 'primary';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACE.sm,
        minHeight: 44,
        padding: `0 ${SPACE.lg}px`,
        borderRadius: RADIUS.pill,
        border: primary ? 'none' : `1px solid ${THEME.border}`,
        background: primary ? THEME.accent : THEME.raised,
        color: primary ? THEME.surface : THEME.text,
        fontFamily: FONT.sans,
        fontSize: TYPE.body.size,
        fontWeight: TYPE.label.weight,
        cursor: disabled ? 'default' : 'pointer',
        width: '100%',
      }}
    >
      {children}
    </button>
  );
}
