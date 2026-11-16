import { THEME } from '../constants/theme.js';
import { SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';

export default function SectionHeader({ children, action }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        margin: `${SPACE.xl}px 0 ${SPACE.sm}px`,
        fontFamily: FONT.sans,
        fontSize: TYPE.title.size,
        fontWeight: TYPE.title.weight,
        letterSpacing: TYPE.title.letterSpacing,
        color: THEME.text,
      }}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}
