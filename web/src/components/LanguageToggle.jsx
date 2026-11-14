import { useId } from 'react';
import { useLanguage } from '../i18n/LanguageProvider.jsx';
import { LANGS, LANG_TAG, LANG_UI } from '../i18n/lang.js';
import { THEME } from '../constants/theme.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';

const TARGET = 44;

// Read by screen readers, not drawn: the cycle button's description.
const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

const next = (l) => LANGS[(LANGS.indexOf(l) + 1) % LANGS.length];

const buttonBase = {
  minWidth: TARGET,
  minHeight: TARGET,
  padding: `0 ${SPACE.sm}px`,
  borderRadius: RADIUS.sm,
  fontFamily: FONT.sans,
  fontSize: TYPE.label.size,
  fontWeight: TYPE.label.weight,
  letterSpacing: TYPE.label.letterSpacing,
  cursor: 'pointer',
};

// The live region reporting a failed switch. Exported so a cramped layout (the
// login card's header row) can put it on a line of its own, full width, rather
// than beside the button where its sentence squeezes the row.
export function LanguageStatus() {
  const { failed } = useLanguage();
  return (
    <div
      aria-live="polite"
      style={{
        fontSize: TYPE.caption.size,
        color: THEME.critical,
        fontFamily: FONT.sans,
      }}
    >
      {failed ? (
        <>
          <div>{LANG_UI.unavailable.en}</div>
          <div lang={LANG_TAG.es}>{LANG_UI.unavailable.es}</div>
        </>
      ) : null}
    </div>
  );
}

// `segmented` where there is room (Settings), `cycle` where there is not (the
// login card): one 44px button showing the language it switches to, in that
// language, so a visitor who cannot read the current one still finds theirs.
// `withStatus={false}` leaves the status to a <LanguageStatus /> placed by the
// caller.
export default function LanguageToggle({
  variant = 'segmented',
  withStatus = true,
}) {
  const { lang, setLang, pending } = useLanguage();
  const describedBy = useId();
  const status = withStatus ? <LanguageStatus /> : null;

  if (variant === 'cycle') {
    const target = next(lang);
    return (
      <div>
        <button
          type="button"
          lang={LANG_TAG[target]}
          aria-describedby={describedBy}
          aria-busy={pending || undefined}
          onClick={() => setLang(target)}
          style={{
            ...buttonBase,
            background: 'transparent',
            border: `1px solid ${THEME.border}`,
            color: THEME.muted,
          }}
        >
          {LANG_UI.native[target]}
        </button>
        <span id={describedBy} lang={LANG_TAG[lang]} style={srOnly}>
          {LANG_UI.describe[lang]}
        </span>
        {status}
      </div>
    );
  }

  return (
    <div>
      <div
        role="group"
        aria-label={LANG_UI.label[lang]}
        aria-busy={pending || undefined}
        style={{ display: 'inline-flex', gap: SPACE.xs }}
      >
        {LANGS.map((l) => {
          const active = l === lang;
          return (
            <button
              key={l}
              type="button"
              lang={LANG_TAG[l]}
              aria-pressed={active}
              onClick={() => setLang(l)}
              style={{
                ...buttonBase,
                background: active ? THEME.accent : 'transparent',
                border: `1px solid ${active ? THEME.accent : THEME.border}`,
                color: active ? THEME.bg : THEME.muted,
              }}
            >
              {LANG_UI.native[l]}
            </button>
          );
        })}
      </div>
      {status}
    </div>
  );
}
