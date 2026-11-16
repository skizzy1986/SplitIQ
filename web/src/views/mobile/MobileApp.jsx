import React, { useEffect, useRef, useState } from 'react';
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
const SCREENS = ['settings'];

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
        onStartSession={() => {
          navigate('train');
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
    content = <MobileProgress onOpenTrain={() => navigate('train')} />;
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
      {!live && route !== 'settings' && (
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
