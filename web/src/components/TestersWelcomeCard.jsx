import { useState } from 'react';
import { useLingui } from '@lingui/react';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { guideFor } from '../constants/firstRunGuide.js';
import {
  dismissWelcomeCard,
  isWelcomeCardDismissed,
  requestGuideOpen,
} from '../utils/firstRunGuide.js';
import { isTestersBuild } from '../utils/testersBuild.js';
import { useSessionOwner } from '../hooks/useSessionOwner.js';

// Compact card on Today / Overview for testers (#797). Hidden on the owner's
// build, and after the tester hides it. No CP field (#819 H 1, H 2).
export default function TestersWelcomeCard() {
  const { i18n } = useLingui();
  const userId = useSessionOwner();
  const copy = guideFor(i18n.locale);
  const [hidden, setHidden] = useState(() => isWelcomeCardDismissed(userId));

  if (!isTestersBuild() || hidden || !userId) return null;
  const card = copy.welcomeCard;

  return (
    <section
      aria-label={card.title}
      style={{
        background: THEME.surface,
        border: `1px solid ${THEME.border}`,
        borderRadius: RADIUS.md,
        padding: `${SPACE.lg}px`,
        marginBottom: SPACE.lg,
        fontFamily: FONT.sans,
        color: THEME.text,
      }}
    >
      <div
        style={{
          fontSize: TYPE.title.size,
          fontWeight: TYPE.title.weight,
          marginBottom: 6,
        }}
      >
        {card.title}
      </div>
      <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5 }}>
        {card.body}
      </p>
      <div
        style={{
          display: 'flex',
          gap: SPACE.sm,
          marginTop: SPACE.md,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => requestGuideOpen(userId)}
          style={linkBtn}
        >
          {card.openGuide}
        </button>
        <button
          type="button"
          onClick={() => {
            dismissWelcomeCard(userId);
            setHidden(true);
          }}
          style={linkBtn}
        >
          {card.dismiss}
        </button>
      </div>
    </section>
  );
}

const linkBtn = {
  minHeight: 44,
  padding: '0 10px',
  background: 'none',
  border: 'none',
  color: THEME.accent,
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
};
