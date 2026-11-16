import { THEME } from '../constants/theme.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';

export default function StatTile({ label, value, detail, tone = 'neutral' }) {
  const color =
    tone === 'neutral'
      ? THEME.text
      : tone === 'form'
        ? THEME.caution
        : THEME.positive;
  return (
    <div
      style={{
        background: THEME.raised,
        borderRadius: RADIUS.md,
        padding: SPACE.md,
        fontFamily: FONT.sans,
      }}
    >
      <div
        style={{
          fontSize: TYPE.label.size,
          fontWeight: TYPE.label.weight,
          color: THEME.textFaint,
          marginBottom: SPACE.xs,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: TYPE.title.size,
          fontWeight: TYPE.title.weight,
          color,
          fontFamily: FONT.mono,
        }}
      >
        {value}
      </div>
      {detail && (
        <div style={{ fontSize: TYPE.label.size, color: THEME.textFaint }}>
          {detail}
        </div>
      )}
    </div>
  );
}
