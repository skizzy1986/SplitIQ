import { lazy, Suspense, useEffect } from 'react';
import { ThemeContext, useTheme } from './hooks/useTheme.js';
import { DARK } from './constants/themeValues.js';
import { Capacitor } from '@capacitor/core';
import {
  canonicalMovementUrl,
  movementForPath,
} from './utils/movementRoute.js';
import { THEME } from './constants/theme.js';
import { LANG_TAG, OFFLINE_TEXT, initialLang } from './i18n/lang.js';

// One bundle, three products: the signed-in dashboard and the public movement
// tools at /squat and /row. Each is its own lazy chunk, so a tool never
// downloads the dashboard — and, load-bearing, never imports
// supabaseClient.js, whose createClient() runs at module top. The Android app
// is the dashboard only.
const AuthGate = lazy(() => import('./AuthGate.jsx'));
// A first visit with no network cannot fetch a tool's chunk (it is not
// precached). Offline, say so in place of a blank ground; online, the
// rejection is a real failure and goes on to the Sentry boundary in main.jsx.
const orOffline = (movement) => (error) => {
  if (navigator.onLine !== false) throw error;
  return {
    default: function OfflineTool() {
      return <ToolOffline movement={movement} />;
    },
  };
};
const TOOLS = {
  squat: lazy(() => import('./squat/SquatApp.jsx').catch(orOffline('squat'))),
  row: lazy(() => import('./row/RowApp.jsx').catch(orOffline('row'))),
};

const movementHere = () =>
  Capacitor.isNativePlatform()
    ? null
    : movementForPath(window.location.pathname);

// Lazy-loading AuthGate added a round trip before the dashboard's first
// paint. Starting the fetch here, at module evaluation rather than at render,
// overlaps it with React's own startup so the cost is close to nil.
// A failure here is not swallowed: the lazy() above requests the same module
// on render and its rejection reaches the Sentry error boundary in main.jsx.
if (!movementHere()) import('./AuthGate.jsx').catch(() => {});
else {
  // Module evaluation runs before the load event, which is when registerSW.js
  // resolves './sw.js' against the document URL — so this must happen here.
  const canonical = canonicalMovementUrl(window.location);
  if (canonical)
    window.history.replaceState(window.history.state, '', canonical);
}

// Resolve the shared preference before any lazy product loads, so the
// loading ground and authentication match the selected theme.
function Ground({ theme, children }) {
  return (
    <div
      data-testid="route-ground"
      data-theme={theme}
      style={{
        minHeight: '100vh',
        background: THEME.bg,
        colorScheme: theme,
      }}
    >
      {children}
    </div>
  );
}

// The tool's catalog is in the chunk that failed to arrive, so the words come
// from the pre-chunk table, in the stored language.
function ToolOffline({ movement }) {
  const lang = initialLang();
  return (
    <Ground>
      <p
        role="alert"
        lang={LANG_TAG[lang]}
        style={{ margin: 0, padding: 24, color: THEME.text }}
      >
        {OFFLINE_TEXT[movement][lang]}
      </p>
    </Ground>
  );
}

export default function RouteRoot() {
  const movement = movementHere();
  const theme = useTheme();
  const { resolved } = theme;
  // The signed-in dashboard is dark regardless of the stored preference.
  // The movement tools keep the shared resolver.
  const painted = movement ? resolved : 'dark';
  useEffect(() => {
    // A movement tool owns the document ground for its standalone surface.
    if (movement) return undefined;
    const ground = DARK.bg;
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
  }, [movement]);
  const Product = movement ? TOOLS[movement] : AuthGate;
  return (
    <ThemeContext.Provider value={theme}>
      <div
        data-testid="theme-root"
        data-theme={painted}
        style={{
          minHeight: '100vh',
          background: THEME.bg,
          colorScheme: painted,
        }}
      >
        <Suspense fallback={<Ground theme={painted} />}>
          <Product />
        </Suspense>
      </div>
    </ThemeContext.Provider>
  );
}
