import { THEME } from '../constants/theme.js';
import { SPACE, TYPE } from '../constants/tokens.js';
import { FONT } from '../constants/type.js';

export default function ScreenHeader({ title, meta }) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: SPACE.md,
        marginBottom: SPACE.lg,
        fontFamily: FONT.sans,
      }}
    >
      <div>
        {meta && (
          <div
            style={{
              fontSize: TYPE.bodySm.size,
              color: THEME.textSubtle,
              marginBottom: SPACE.xs,
            }}
          >
            {meta}
          </div>
        )}
        <h1
          style={{
            margin: 0,
            fontSize: TYPE.title.size,
            fontWeight: TYPE.title.weight,
            letterSpacing: TYPE.title.letterSpacing,
            lineHeight: TYPE.title.lineHeight,
            color: THEME.text,
          }}
        >
          {title}
        </h1>
      </div>
    </header>
  );
}
