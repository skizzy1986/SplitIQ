import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { SPACE, TYPE } from '../constants/tokens.js';

// Skeleton only. Later phases port the v10 builder, Ready, live split table,
// rest and summary into this module. Not wired into Train yet, so it does not
// move the bundle until a caller uses loadLiveErgSession().
export default function LiveErgSession() {
  return (
    <main
      data-testid="live-erg-session"
      style={{
        minHeight: '100%',
        boxSizing: 'border-box',
        padding: SPACE.lg,
        background: THEME.bg,
        color: THEME.text,
        fontFamily: FONT.sans,
      }}
    >
      <h1
        style={{
          margin: 0,
          color: THEME.text,
          fontFamily: FONT.sans,
          fontSize: TYPE.title.size,
          fontWeight: TYPE.title.weight,
          letterSpacing: TYPE.title.letterSpacing,
          lineHeight: TYPE.title.lineHeight,
        }}
      >
        Live session
      </h1>
    </main>
  );
}
