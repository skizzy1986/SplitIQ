import { THEME } from '../constants/theme.js';
import { RADIUS, TYPE } from '../constants/tokens.js';
import { isSampleSession } from '../utils/firstRunGuide.js';
import { isTestersBuild } from '../utils/testersBuild.js';

const LABEL = { en: 'Sample data', es: 'Datos de ejemplo' };

// Shown on a session the sample-data branch flagged with source='sample'.
// Official builds never render this, even if a row happens to carry that flag.
export default function SampleDataBadge({ session, locale }) {
  if (!isTestersBuild() || !isSampleSession(session)) return null;
  const es = /^es(-|$)/i.test(String(locale ?? ''));
  return (
    <span
      style={{
        display: 'inline-block',
        marginLeft: 8,
        padding: '1px 6px',
        borderRadius: RADIUS.sm,
        border: `1px solid ${THEME.border}`,
        color: THEME.muted,
        fontSize: TYPE.micro.size,
        letterSpacing: TYPE.micro.letterSpacing,
        textTransform: 'uppercase',
        verticalAlign: 'middle',
      }}
    >
      {es ? LABEL.es : LABEL.en}
    </span>
  );
}
