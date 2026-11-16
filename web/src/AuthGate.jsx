import { useState, useEffect, useRef, useContext, lazy, Suspense } from 'react';
import { supabase } from './supabaseClient.js';
import { QueryClientContext } from '@tanstack/react-query';
import { SessionOwnerContext } from './hooks/useSessionOwner.js';
import {
  startPrivateSession,
  storedSessionOwner,
  rememberSessionOwner,
} from './utils/privateSessionState.js';
import { usePWAInstall } from './hooks/usePWAInstall.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { useSplashGate } from './hooks/useSplashGate.js';
import { useInitialDataReady } from './hooks/useInitialDataReady.js';
import SplashScreen from './components/SplashScreen.jsx';
import { captureError } from './utils/sentry.js';
import { THEME } from './constants/theme.js';
import { FONT } from './constants/type.js';
import { TYPE, SPACE } from './constants/tokens.js';
import { brandLine } from './utils/brandLine.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import './i18n/dashboard.js';
import LanguageProvider from './i18n/LanguageProvider.jsx';
import LanguageToggle, {
  LanguageStatus,
} from './components/LanguageToggle.jsx';
import { authErrorText } from './utils/authError.js';

// A device renders one shell, never both. Statically importing the pair put
// the desktop dashboard's thirteen tabs and the whole mobile app in the same
// first-paint chunk, so every phone downloaded a dashboard it cannot reach
// and every desktop downloaded a phone app it cannot reach.
const App = lazy(() => import('./App.jsx'));
const MobileApp = lazy(() => import('./views/mobile/MobileApp.jsx'));

const MISSING_FIELDS = msg({
  message: 'Enter email and password.',
  comment: 'Login form validation error.',
});

// ── THEME TOKENS (match the dashboard) ───────────────────────────
// ── LOGIN SCREEN ─────────────────────────────────────────────────
function Login() {
  const { t, i18n } = useLingui();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // The cause, not its text: rendered in whichever language is active, so a
  // switch mid-error re-reads it instead of leaving the old language behind.
  const [err, setErr] = useState(null);
  const line = brandLine(i18n.locale);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErr({ missing: true });
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) setErr({ error });
    // On success, onAuthStateChange in AuthGate swaps the view.
  };

  const errText = err?.missing
    ? t(MISSING_FIELDS)
    : authErrorText(err?.error, i18n.locale);

  const inp = {
    background: THEME.field,
    border: `1px solid ${THEME.border}`,
    borderRadius: 5,
    padding: '11px 12px',
    fontSize: 14,
    color: THEME.text,
    fontFamily: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
  };
  const lbl = {
    fontSize: 9,
    letterSpacing: 1,
    color: THEME.muted,
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: THEME.bg,
        fontFamily: FONT.sans,
        padding: 20,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%',
          maxWidth: 320,
          background: THEME.raised,
          border: `1px solid ${THEME.border}`,
          borderRadius: 10,
          padding: '26px 22px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: THEME.positive,
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            SPLITIQ
          </div>
          {/* Reachable before sign-in, so the language can change without an
              account. */}
          <LanguageToggle variant="cycle" withStatus={false} />
        </div>
        <div
          lang={line.lang}
          style={{
            fontSize: TYPE.body.size,
            fontWeight: 600,
            letterSpacing: TYPE.title.letterSpacing,
            lineHeight: TYPE.title.lineHeight,
            color: THEME.text,
            marginBottom: SPACE.sm,
          }}
        >
          {line.lead}{' '}
          <span
            style={{
              fontFamily: FONT.mono,
              fontWeight: 700,
              letterSpacing: 0,
              color: THEME.accent,
            }}
          >
            {line.head}
          </span>
        </div>
        {/* Its own full-width line: beside the toggle, the sentence would
            squeeze the header row on a 360px phone. */}
        <LanguageStatus />
        <div style={{ fontSize: 11, color: THEME.muted, marginBottom: 22 }}>
          <Trans>Sign in to continue</Trans>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={lbl} htmlFor="login-email">
            <Trans comment="Login form field label, all capitals">EMAIL</Trans>
          </label>
          <input
            id="login-email"
            style={inp}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={lbl} htmlFor="login-password">
            <Trans comment="Login form field label, all capitals">
              PASSWORD
            </Trans>
          </label>
          <input
            id="login-password"
            style={inp}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {errText && (
          <div
            style={{
              fontSize: 11,
              color: THEME.critical,
              marginBottom: 14,
              lineHeight: 1.5,
            }}
          >
            {errText}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%',
            background: busy ? THEME.border : THEME.positive,
            border: 'none',
            borderRadius: 6,
            padding: '12px',
            fontSize: 13,
            fontWeight: 700,
            color: THEME.surface,
            cursor: busy ? 'default' : 'pointer',
            fontFamily: 'inherit',
            letterSpacing: 1,
          }}
        >
          {busy
            ? t({
                message: 'SIGNING IN…',
                comment: 'Login button while the request is in flight',
              })
            : t({ message: 'SIGN IN', comment: 'Login button' })}
        </button>
      </form>
    </div>
  );
}

// ── LOADING PANE ─────────────────────────────────────────────────
// Used twice: while the session is unresolved, and while a shell chunk is in
// flight. One definition so the two cannot drift apart.
function LoadingPane() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: THEME.bg,
        color: THEME.muted,
        fontFamily: FONT.sans,
        fontSize: 12,
      }}
    >
      <Trans comment="Shown while the session or the app is loading">
        Loading…
      </Trans>
    </div>
  );
}

// ── SIGN-OUT BUTTON (floating, top-right) ────────────────────────
function SignOutButton() {
  const { t } = useLingui();
  return (
    <button
      onClick={() => supabase.auth.signOut()}
      style={{
        position: 'fixed',
        left: 16,
        bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
        zIndex: 1000,
        minHeight: 44,
        minWidth: 44,
        background: THEME.raised,
        border: `1px solid ${THEME.border}`,
        borderRadius: 999,
        padding: '0 16px',
        fontSize: 12,
        color: THEME.text,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
      title={t({
        message: 'Sign out',
        comment: 'Tooltip on the sign-out button',
      })}
      aria-label={t({
        message: 'Sign out',
        comment: 'Tooltip on the sign-out button',
      })}
    >
      <Trans>Sign out</Trans>
    </button>
  );
}

// ── INSTALL BUTTON (floating, bottom-right) ──────────────────────
function InstallButton() {
  const { canInstall, installed, installPrompt } = usePWAInstall();
  if (!canInstall || installed) return null;
  return (
    <button
      onClick={installPrompt}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 999,
        background: THEME.positive,
        border: 'none',
        borderRadius: 5,
        padding: '10px 14px',
        fontSize: 11,
        letterSpacing: 1,
        fontWeight: 700,
        color: THEME.surface,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <Trans comment="Install-the-app button, all capitals">
        ＋ ADD TO HOME SCREEN
      </Trans>
    </button>
  );
}

// ── AUTH GATE ────────────────────────────────────────────────────
// undefined = still checking, null = logged out, object = signed in.
function Gate() {
  const [session, setSession] = useState(undefined);
  // Login can render standalone; the signed-in app receives this client in main.
  const queryClient = useContext(QueryClientContext);
  const ownerRef = useRef(undefined);
  const [authFailed, setAuthFailed] = useState(false);
  const isMobile = useIsMobile();
  const dataReady = useInitialDataReady();
  const showSplash = useSplashGate({
    enabled: true,
    authResolved: session !== undefined,
    authFailed,
    dataReady,
    dataExpected: !!session,
  });

  useEffect(() => {
    let active = true;
    let revision = 0;
    const acceptSession = (next) => {
      if (!active) return;
      const nextOwner = next?.user?.id ?? null;
      const previous =
        ownerRef.current === undefined
          ? storedSessionOwner()
          : ownerRef.current;
      if (ownerRef.current === undefined || ownerRef.current !== nextOwner) {
        queryClient?.clear();
      }
      // Any owner change starts a new private session: stale callbacks are cut
      // off and ownerless legacy work is quarantined. Owned unsynced work stays.
      if (previous !== nextOwner && (previous !== null || nextOwner)) {
        startPrivateSession();
      }
      ownerRef.current = nextOwner;
      rememberSessionOwner(nextOwner);
      setSession(next);
    };
    const initialRevision = revision;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (revision === initialRevision) acceptSession(data.session);
      })
      .catch((error) => {
        if (!active || revision !== initialRevision) return;
        captureError(error, { where: 'AuthGate.getSession' });
        setAuthFailed(true);
        acceptSession(null);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      revision += 1;
      acceptSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);

  let body;
  if (session === undefined) {
    body = showSplash ? null : <LoadingPane />;
  } else if (!session) {
    body = showSplash ? null : <Login />;
  } else {
    body = (
      <SessionOwnerContext.Provider
        key={session.user?.id}
        value={session.user?.id ?? null}
      >
        {/* On a phone the floating button sat over the top bar's Settings button, so
            sign-out lives on the mobile Settings screen instead. Held back
            while the splash covers the page, or Tab reaches a hidden button. */}
        {!isMobile && !showSplash && <SignOutButton />}
        {/* The shell chunk is fetched here rather than at first paint. The
            splash is already covering this window; once it has dismissed at
            its ceiling, fall back to the same pane the unresolved branch uses, so a slow
            chunk reads as loading rather than as a blank screen. */}
        <Suspense fallback={showSplash ? null : <LoadingPane />}>
          {isMobile ? <MobileApp /> : <App />}
        </Suspense>
      </SessionOwnerContext.Provider>
    );
  }

  // One flat shape across all three branches, so the splash keeps a stable
  // child index. Returning a different fragment per branch remounted it the
  // moment the session resolved — React reconciles fragment children by index,
  // so the splash landed on a different slot and replayed its whole entrance
  // mid-animation. It also overlays rather than replaces once signed in: the
  // tabs' fetches only start when MobileApp mounts, so it has to be mounted
  // and fetching underneath.
  return (
    <>
      {body}
      {showSplash && <SplashScreen />}
      <InstallButton />
    </>
  );
}

// The language provider wraps all three branches, so the login screen is in
// the visitor's language before there is an account to store it against. A
// stored Spanish choice holds the first paint on RouteRoot's ground until the
// catalog arrives (see LanguageProvider).
export default function AuthGate() {
  return (
    <LanguageProvider product="dashboard">
      <Gate />
    </LanguageProvider>
  );
}
