import { useEffect } from 'react';
import { THEME } from '../constants/theme.js';
import { DARK, LIGHT } from '../constants/themeValues.js';
import { FONT } from '../constants/type.js';
import { RADIUS, SPACE, TYPE } from '../constants/tokens.js';
import { useTheme } from '../hooks/useTheme.js';
import { PAGE_DESCRIPTION, PAGE_TITLE, PLACEHOLDER } from './constants/page.js';

// /row until the rowing model lands (#760): a public placeholder that proves
// the route end to end. No data, no worker, no Supabase. It imports only
// modules the dashboard's first paint already loads, so the build splits off
// no shared chunk that only the tools can reach (a plain name, then, that the
// precache would take).

// Points <meta name> at `content`, creating the tag when the page has none.
// Returns the undo.
function setMeta(name, content) {
  let meta = document.querySelector(`meta[name="${name}"]`);
  const created = !meta;
  if (created) {
    meta = document.createElement('meta');
    meta.setAttribute('name', name);
    document.head.appendChild(meta);
  }
  const previous = meta.getAttribute('content');
  meta.setAttribute('content', content);
  return () => {
    if (created) meta.remove();
    else if (previous == null) meta.removeAttribute('content');
    else meta.setAttribute('content', previous);
  };
}

// noindex because the page is a placeholder. Set here rather than as a host
// header, so it leaves with the placeholder and cannot outlive it onto the
// real page.
function usePageMeta() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = PAGE_TITLE;
    const restoreDescription = setMeta('description', PAGE_DESCRIPTION);
    const restoreRobots = setMeta('robots', 'noindex');
    return () => {
      document.title = previousTitle;
      restoreDescription();
      restoreRobots();
    };
  }, []);
}

// data-theme sits on the page root, but the document behind it (overscroll,
// the iOS status bar) would keep the app's ground. Values, not THEME: the body
// is outside the root, so a var() there resolves to :root's palette.
function useDocumentGround(resolved) {
  useEffect(() => {
    const ground = (resolved === 'dark' ? DARK : LIGHT).bg;
    const body = document.body.style;
    const previous = body.backgroundColor;
    const meta = document.querySelector('meta[name="theme-color"]');
    const previousMeta = meta?.getAttribute('content');
    body.backgroundColor = ground;
    meta?.setAttribute('content', ground);
    return () => {
      body.backgroundColor = previous;
      if (meta) {
        if (previousMeta == null) meta.removeAttribute('content');
        else meta.setAttribute('content', previousMeta);
      }
    };
  }, [resolved]);
}

export default function RowApp() {
  // The shared Light/Dark/Auto preference, read the way /squat reads it; the
  // hook keeps its own state, so no provider is needed above the page.
  const { resolved } = useTheme();
  usePageMeta();
  useDocumentGround(resolved);
  return (
    <div
      data-testid="row-root"
      data-theme={resolved}
      style={{
        minHeight: '100vh',
        boxSizing: 'border-box',
        padding: `${SPACE.xxl}px ${SPACE.lg}px`,
        background: THEME.bg,
        color: THEME.text,
        fontFamily: FONT.sans,
        colorScheme: resolved,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      {/* On a card: no accent ink passes AA on the light ground, so the link
          cannot sit on it directly (conventions.md). */}
      <main
        style={{
          maxWidth: 560,
          margin: '0 auto',
          padding: SPACE.xl,
          boxSizing: 'border-box',
          background: THEME.surface,
          border: `1px solid ${THEME.border}`,
          borderRadius: RADIUS.md,
        }}
      >
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
          {PLACEHOLDER.heading}
        </h1>
        <p
          style={{
            margin: `${SPACE.sm}px 0 0`,
            fontSize: TYPE.body.size,
            fontWeight: TYPE.body.weight,
            lineHeight: TYPE.body.lineHeight,
            color: THEME.textSubtle,
          }}
        >
          {PLACEHOLDER.body}
        </p>
        <a
          href={PLACEHOLDER.squatHref}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            minHeight: 44,
            marginTop: SPACE.sm,
            fontSize: TYPE.body.size,
            fontWeight: 600,
            color: THEME.accent,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          {PLACEHOLDER.squatLink}
        </a>
      </main>
    </div>
  );
}
