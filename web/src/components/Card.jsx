import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE } from '../constants/tokens.js';

export default function Card({ children, accent }) {
  return (
    <div
      style={{
        background: THEME.surface,
        border: `1px solid ${THEME.divider}`,
        borderLeft: accent ? `3px solid ${accent}` : undefined,
        borderRadius: RADIUS.lg,
        padding: SPACE.lg,
        marginBottom: SPACE.sm,
      }}
    >
      {children}
    </div>
  );
}
