import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import '../../i18n/views.js';
import MobileToday from './MobileToday.jsx';
import MobileProgress from './MobileProgress.jsx';
import MobileTrain from './MobileTrain.jsx';
import MobileRecovery from './MobileRecovery.jsx';
import MobileSettings from './MobileSettings.jsx';
import MobileTopBar from '../../components/mobile/MobileTopBar.jsx';
import BottomTabBar, {
  TAB_BAR_HEIGHT,
} from '../../components/mobile/BottomTabBar.jsx';
import { useLingui } from '@lingui/react';
import { useHashRoute } from '../../hooks/useHashRoute.js';
import { useHashSessionId } from '../../hooks/useHashSessionId.js';
import {
  focusSessionLink,
  sessionIdFromHash,
} from '../../utils/sessionPage.js';
import {
  DEFAULT_DESTINATION,
  DESTINATIONS,
  isDestination,
} from '../../constants/destinations.js';
import { THEME } from '../../constants/theme.js';
import { FONT } from '../../constants/type.js';
import {
  readStravaCallback,
  stravaCallbackMessage,
  clearStravaCallbackFromUrl,
} from '../../utils/stravaCallback.js';

// Screens the shell shows that are not destinations: no tab of their own, so
// the tab bar shows none active while one is open.
const SCREENS = ['settings', 'session'];

// Lazy, so the session page and its charts never join the shell's chunk.
const SessionView = lazy(() => import('../SessionView.jsx'));

export default function MobileApp() {
  const { _ } = useLingui();
  // The Strava OAuth callback returns to the app root with the outcome in the
  // query string (`/?strava=connected`), not in the hash, so the hash cannot
  // route it. Read it once, in a state initialiser rather than useMemo — React
  // may discard a memo, and this must not be re-read after the URL is cleaned.
  // While it is present Settings is the first screen painted, as on desktop.
  const [stravaCallback] = useState(() => readStravaCallback(window.location));
  const [route, navigate] = useHashRoute(
    SCREENS,
    stravaCallback ? 'settings' : null
  );
  const [stravaNotice, setStravaNotice] = useState(() =>
    stravaCallbackMessage(stravaCallback)
  );
  // Strip the params so a refresh does not replay the outcome, and point the
  // hash at the screen actually showing so a reload stays on it.
  useEffect(() => {
    if (!stravaCallback) return;
    clearStravaCallbackFromUrl(window);
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}#/settings`);
  }, [stravaCallback]);
  // The notice reports one OAuth return. Once you leave Settings it is spent,
  // so Back then Settings again does not announce "Strava connected" again. Route
  // changes also arrive from hashchange (browser back), so this is adjusted
  // during render rather than in each handler.
  if (stravaNotice && route !== 'settings') setStravaNotice(null);
  // Where Settings returns to: the destination it was opened from. Today when
  // it was reached some other way (a #/settings reload, the Strava callback).
  const [returnTo, setReturnTo] = useState(DEFAULT_DESTINATION);
  // Returning from Settings by Back puts focus on the bar's Settings button
  // that opened it; any other way of reaching a destination does not.
  const [focusSettings, setFocusSettings] = useState(false);
  const settingsRef = useRef(null);
  const openSettings = () => {
    setReturnTo(isDestination(route) ? route : DEFAULT_DESTINATION);
    setFocusSettings(false);
    navigate('settings');
  };
  const leaveSettings = () => {
    setFocusSettings(true);
    navigate(returnTo);
  };
  // Which session Train is running, if any. Held here rather than inside Train
  // because it decides whether the tab bar exists.
  const [trainMode, setTrainMode] = useState(null);

  // The session page: its id lives in the hash after `#/session/`.
  const sessionId = useHashSessionId();
  // Progress's pane is Progress's own. The shell only remembers the pane a
  // session was opened from, and hands it to Progress once, for the landing
  // after Back; then it lets go, so opening Progress later starts as on main.
  const lastProgressPane = useRef(null);
  const [landingPane, setLandingPane] = useState(null);
  // Progress reads it once, on mount; leaving Progress (or never reaching
  // it) releases it. Adjusted during render, like the Strava notice above.
  if (landingPane && route !== 'session' && route !== 'progress')
    setLandingPane(null);
  const sessionFromApp = useRef(false);
  const previousRoute = useRef(route);
  const lastSession = useRef(null);
  useEffect(() => {
    const from = previousRoute.current;
    // Read the hash itself, not `sessionId`: the route and the id follow two
    // separate hashchange listeners, and React can render between them, so
    // for one render the route is 'session' while the id state still lags.
    const liveId = sessionIdFromHash(window.location.hash);
    if (route === 'session' && liveId == null) {
      // A malformed session link canonicalises to Today, as on desktop.
      const { pathname, search } = window.location;
      window.history.replaceState(null, '', `${pathname}${search}#/today`);
      navigate(DEFAULT_DESTINATION);
    } else if (route === 'session') {
      // Only a real in-app navigation counts (StrictMode's double mount run
      // sees no change); a trip to Settings and back keeps the flag.
      if (from !== route && from !== 'settings') sessionFromApp.current = true;
      lastSession.current = liveId;
    } else if (route !== 'settings') {
      if (lastSession.current != null) focusSessionLink(lastSession.current);
      lastSession.current = null;
      sessionFromApp.current = false;
    }
    if (route !== 'progress' && route !== 'session' && route !== 'settings') {
      lastProgressPane.current = null;
    }
    previousRoute.current = route;
  }, [route, sessionId, navigate]);
  const leaveSession = () => {
    setLandingPane(lastProgressPane.current ?? 'history');
    if (sessionFromApp.current) {
      window.history.back();
      return;
    }
    navigate('progress');
  };

  // A live session owns the screen (HANDOFF.md §4), so the bar goes away and
  // the shell stops reserving room for it. The mode is deliberately not
  // cleared when you leave Train: stepping over to Body mid-piece and coming
  // back should return you to the session, not discard it.
  const live = route === 'train' && trainMode != null;
  // Spent once the bar unmounts, so it cannot refocus when it next mounts.
  if (focusSettings && (route === 'settings' || live)) setFocusSettings(false);

  // Back unwinds one level at a time: out of a live session, then to Today,
  // then out of the app. Kept in a ref so the listener below can be registered
  // exactly once while still seeing the current route.
  const onBack = useRef(null);
  // Declared before the registration effect so the handler exists by the time
  // the listener is attached. No dep array: it must track every render.
  useEffect(() => {
    onBack.current = () => {
      if (live) setTrainMode(null);
      else if (route === 'settings') leaveSettings();
      else if (route === 'session') leaveSession();
      else if (route !== DEFAULT_DESTINATION) navigate(DEFAULT_DESTINATION);
      else App.minimizeApp();
    };
  });

  // Registered once, never re-registered. Both halves of Capacitor's listener
  // API are async: addListener resolves a handle, and the previous effect
  // removed it inside a .then(). React does not await a cleanup, so the order
  // of "old removed" against "new registered" was not guaranteed — leaving a
  // window with two listeners holding different closures, or none at all and a
  // dropped back press. Re-registering on every navigation bought nothing.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let handle = null;
    let cancelled = false;
    App.addListener('backButton', () => onBack.current?.()).then((h) => {
      handle = h;
      if (cancelled) h.remove();
    });
    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, []);

  let content;
  if (route === 'today')
    content = (
      <MobileToday
        onStartSession={(intent) => {
          navigate('train');
          // planned / again / just-row go straight into the erg live flow.
          // pick (Tweak, Pick a workout, Open Train) lands on the Train list.
          if (intent && intent !== 'pick') setTrainMode('erg');
          else setTrainMode(null);
        }}
        onOpenBody={() => navigate('body')}
      />
    );
  else if (route === 'settings')
    content = (
      <MobileSettings
        onBack={leaveSettings}
        returnLabel={_(DESTINATIONS.find((d) => d.id === returnTo).message)}
        notice={stravaNotice}
      />
    );
  else if (route === 'train')
    content = <MobileTrain mode={trainMode} onMode={setTrainMode} />;
  else if (route === 'progress')
    content = (
      <MobileProgress
        onOpenTrain={() => navigate('train')}
        initialPane={landingPane ?? undefined}
        onPane={(pane) => {
          lastProgressPane.current = pane;
        }}
      />
    );
  else if (route === 'session')
    content =
      sessionId == null ? null : (
        <Suspense fallback={null}>
          <SessionView
            key={sessionId}
            sessionId={sessionId}
            onBack={leaveSession}
            layout="phone"
          />
        </Suspense>
      );
  else content = <MobileRecovery onOpenSettings={openSettings} />;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: THEME.bg,
        fontFamily: FONT.sans,
        paddingBottom: live
          ? 0
          : `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))`,
      }}
    >
      {!live && route !== 'settings' && route !== 'session' && (
        <MobileTopBar
          onOpenSettings={openSettings}
          settingsRef={settingsRef}
          focusSettings={focusSettings}
        />
      )}
      {/* <main> scopes each view's own <header>, so the top bar stays the one banner. */}
      <main>{content}</main>
      {!live && <BottomTabBar activeTab={route} onTabChange={navigate} />}
    </div>
  );
}
