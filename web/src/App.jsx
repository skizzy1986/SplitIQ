import {
  useState,
  useEffect,
  useMemo,
  useRef,
  Component,
  lazy,
  Suspense,
} from 'react';
import { captureError } from './utils/sentry.js';
import { useSessions } from './hooks/useSessions.js';
import { selectSessionLog } from './utils/sessionLog.js';
import { useDesktopRoute } from './hooks/useDesktopRoute.js';
import { DESKTOP_PANES } from './utils/desktopRoute.js';
import { DESTINATIONS } from './constants/destinations.js';
import { RADIUS, SPACE, TYPE } from './constants/tokens.js';
import Icon from './components/Icon.jsx';
import SegmentedControl from './components/SegmentedControl.jsx';
import { useTSSHistory } from './hooks/useTSSHistory.js';
import {
  readStravaCallback,
  stravaCallbackMessage,
  clearStravaCallbackFromUrl,
} from './utils/stravaCallback.js';
import { tsbBand, calcTrainingLoad } from './utils/trainingLoad.js';
import { THEME } from './constants/theme.js';
import { alpha } from './utils/themeCss.js';
import { FONT } from './constants/type.js';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import './i18n/views.js';
import { version } from '../package.json';
import { versionLabel } from './utils/appVersion.js';

const VERSION_LABEL = versionLabel(version);

// Every tab is lazy. Only one is on screen at a time, and three of them are
// among the heaviest files in the repo (StrengthLogger ~1,682, OverviewView
// ~1,423, ErgView ~1,271), so shipping every tab to
// paint one of them was most of the entry chunk. React.lazy caches the
// resolved module, so only a tab's FIRST visit suspends.
const StrengthLogger = lazy(() => import('./StrengthLogger.jsx'));
const ErgLiveView = lazy(() => import('./views/ErgLiveView.jsx'));
const ErgView = lazy(() => import('./views/ErgView.jsx'));
const RecoveryView = lazy(() => import('./views/RecoveryView.jsx'));
const StrengthView = lazy(() => import('./views/StrengthView.jsx'));
const MobilityView = lazy(() => import('./views/MobilityView.jsx'));
const LoadView = lazy(() => import('./views/mobile/MobileAnalytics.jsx'));
const OverviewView = lazy(() => import('./views/OverviewView.jsx'));
const CalendarView = lazy(() => import('./views/CalendarView.jsx'));
const PlanView = lazy(() => import('./views/PlanView.jsx'));
const LogView = lazy(() => import('./views/LogView.jsx'));
const SettingsView = lazy(() => import('./views/SettingsView.jsx'));

// ── ERROR BOUNDARY (beta hardening) ───────────────────────────
// Isolates render failures so one bad tab doesn't white-screen the app.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, msg: '' };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, msg: error?.message || 'Render error' };
  }
  // Isolating the failure must not mean hiding it. Without this the boundary
  // caught every render error in every tab and nothing ever reached Sentry.
  componentDidCatch(error, info) {
    captureError(error, { componentStack: info?.componentStack });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '24px',
            background:
              'color-mix(in srgb, var(--color-critical) 12%, var(--color-bg))',
            border: `1px solid ${alpha(THEME.critical, '50')}`,
            borderRadius: 6,
            color: THEME.critical,
            fontFamily: FONT.mono,
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <Trans comment="Shown in place of a dashboard tab that crashed">
            ⚠️ This section hit a render error and was isolated to protect the
            rest of the dashboard.
          </Trans>
          <br />
          <span style={{ color: THEME.neutralAccent, fontSize: 10 }}>
            {this.state.msg}
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

// A live tool stays mounted after its first visit: navigating to Body or
// Settings must not disconnect the PM5 or discard an in-progress strength draft.
function LiveTool({ active, children }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!active && !visited) return null;
  return (
    <div hidden={!active}>
      <ErrorBoundary>
        <Suspense fallback={null}>{children}</Suspense>
      </ErrorBoundary>
    </div>
  );
}

const PANE_LABELS = {
  overview: msg({ message: 'Overview', comment: 'Desktop Today pane' }),
  calendar: msg({ message: 'Calendar', comment: 'Desktop Today pane' }),
  plan: msg({ message: 'Plan', comment: 'Desktop Train pane' }),
  live: msg({ message: 'Live', comment: 'Desktop live erg pane' }),
  logger: msg({ message: 'Logger', comment: 'Desktop strength logging pane' }),
  mobility: msg({ message: 'Mobility', comment: 'Desktop Train pane' }),
  load: msg({ message: 'Load', comment: 'Desktop Progress pane' }),
  erg: msg({ message: 'Erg', comment: 'Desktop Progress pane' }),
  strength: msg({ message: 'Strength', comment: 'Desktop Progress pane' }),
  history: msg({ message: 'History', comment: 'Desktop Progress pane' }),
};

const navStyle = {
  minHeight: 44,
  borderRadius: RADIUS.sm,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  fontSize: TYPE.body.size,
  fontWeight: TYPE.label.weight,
  fontFamily: FONT.sans,
  cursor: 'pointer',
  background: 'transparent',
};

export default function App() {
  const { _ } = useLingui();
  const [initialCallback] = useState(() => readStravaCallback(window.location));
  const [noticeCallback, setNoticeCallback] = useState(initialCallback);
  const [route, navigate] = useDesktopRoute(
    initialCallback ? 'settings' : null
  );
  const view = route.pane === 'history' ? 'log' : route.pane;
  const stravaNotice = stravaCallbackMessage(noticeCallback);
  if (noticeCallback && view !== 'settings') setNoticeCallback(null);
  const settingsRef = useRef(null);
  const returnRoute = useRef('today');
  const previousRoute = useRef(route.path);
  useEffect(() => {
    if (route.path !== 'settings') {
      if (previousRoute.current === 'settings') settingsRef.current?.focus();
      returnRoute.current = route.path;
    }
    previousRoute.current = route.path;
  }, [route.path]);
  useEffect(() => {
    if (initialCallback) clearStravaCallbackFromUrl(window);
  }, [initialCallback]);
  const [vw, setVw] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  ); // viewport width → responsive layout
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Responsive breakpoints: wider container on desktop, multi-column where it helps.
  const isWide = vw >= 900; // desktop — use the extra width

  const sessions = useSessions({ mode: 'all' });
  const {
    loggedSessions,
    cancelledSessions,
    logDisplaySessions,
    plannedSessions,
    loggedKeys,
  } = useMemo(() => selectSessionLog(sessions.data ?? []), [sessions.data]);
  const dbStatus = sessions.isLoading
    ? 'loading'
    : sessions.isError
      ? 'error'
      : 'ok';
  const fetchSessions = sessions.refetch;

  // Live CTL/ATL/TSB. Previously calcTrainingLoad(DAILY_TSS) — a static seed
  // that stopped on 2026-06-13, so every headline load number on desktop was
  // decorative while mobile already read this same hook.
  const { data: tssHistory, isLoading: loadPending } = useTSSHistory();
  // calcTrainingLoad reduces over isoDates[0], so an empty series would walk
  // from an Invalid Date. Guard rather than let it produce a garbage row.
  const loadData = useMemo(
    () => (tssHistory?.length ? calcTrainingLoad(tssHistory) : []),
    [tssHistory]
  );
  const latest = loadData[loadData.length - 1] ?? null;
  // Pending is deliberately not unavailable (#196): a slow first read must not
  // flash an outage line and then replace it with real numbers.
  const loadAvailable = latest != null;
  const loadUnavailable = !loadAvailable && !loadPending;
  const tsbColor =
    THEME[tsbBand(loadAvailable ? latest.tsb : null)?.token] ?? THEME.muted;

  const ergSessions = loggedSessions.filter((e) => e._isErg);
  const strengthSessions = loggedSessions.filter((e) => e.exercises);
  const latestErg = ergSessions[0]; // dbSessions are training-date-desc
  // Was hardcoded at 55000. The logged erg sessions actually sum to ~216km, so
  // the headline understated the work by about 4x.
  const totalErgDist = ergSessions.reduce((m, e) => m + (e.distance_m ?? 0), 0);
  const totalSessions = loggedSessions.length;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: THEME.bg,
        color: THEME.text,
        fontFamily: FONT.sans,
        display: 'flex',
        overflowX: 'hidden',
        maxWidth: '100vw',
        boxSizing: 'border-box',
      }}
    >
      <aside
        style={{
          width: 240,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column',
          borderRight: `1px solid ${THEME.divider}`,
          padding: '28px 16px 80px',
          boxSizing: 'border-box',
        }}
      >
        {VERSION_LABEL && (
          <div
            style={{
              fontSize: TYPE.label.size,
              color: THEME.textFaint,
            }}
          >
            {VERSION_LABEL}
          </div>
        )}
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: THEME.textStrong,
            letterSpacing: -1,
            marginBottom: SPACE.lg,
          }}
        >
          SPLITIQ
        </div>
        <nav
          aria-label={_(msg`Main navigation`)}
          style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}
        >
          {DESTINATIONS.map(({ id, message, icon }) => (
            <button
              key={id}
              type="button"
              aria-current={route.destination === id ? 'page' : undefined}
              onClick={() => navigate(id)}
              style={{
                ...navStyle,
                display: 'flex',
                alignItems: 'center',
                gap: SPACE.sm,
                borderTop: `2px solid ${
                  route.destination === id ? THEME.accent : 'transparent'
                }`,
                borderRight: 'none',
                borderBottom: 'none',
                borderLeft: 'none',
                borderRadius: RADIUS.md,
                color: route.destination === id ? THEME.text : THEME.textSubtle,
                background:
                  route.destination === id
                    ? `color-mix(in srgb, ${THEME.accent} 12%, transparent)`
                    : 'transparent',
              }}
            >
              <Icon name={icon} />
              {_(message)}
            </button>
          ))}
          <button
            ref={settingsRef}
            type="button"
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => navigate('settings')}
            style={{
              ...navStyle,
              display: 'flex',
              alignItems: 'center',
              gap: SPACE.sm,
              borderTop: `2px solid ${
                view === 'settings' ? THEME.accent : 'transparent'
              }`,
              borderRight: 'none',
              borderBottom: 'none',
              borderLeft: 'none',
              borderRadius: RADIUS.md,
              color: view === 'settings' ? THEME.text : THEME.textSubtle,
              background:
                view === 'settings'
                  ? `color-mix(in srgb, ${THEME.accent} 12%, transparent)`
                  : 'transparent',
            }}
          >
            <Icon name="settings" />
            <Trans>Settings</Trans>
          </button>
        </nav>
      </aside>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          padding: isWide ? '24px' : '16px',
          boxSizing: 'border-box',
        }}
      >
        {route.destination && DESKTOP_PANES[route.destination].length > 1 && (
          <div style={{ marginBottom: SPACE.lg }}>
            <SegmentedControl
              label={_(msg`Sections`)}
              value={route.pane}
              onChange={(pane) => {
                const panes = DESKTOP_PANES[route.destination];
                const index = panes.indexOf(pane);
                navigate(
                  index === 0
                    ? route.destination
                    : `${route.destination}/${pane}`
                );
              }}
              items={DESKTOP_PANES[route.destination].map((pane) => ({
                id: pane,
                label: _(PANE_LABELS[pane]),
              }))}
            />
          </div>
        )}
        {view === 'settings' && (
          <button
            type="button"
            onClick={() => navigate(returnRoute.current)}
            style={{
              ...navStyle,
              border: `1px solid ${THEME.border}`,
              color: THEME.text,
              marginBottom: SPACE.md,
            }}
          >
            <Trans>Back</Trans>
          </button>
        )}

        <LiveTool active={view === 'logger'}>
          <StrengthLogger />
        </LiveTool>
        <LiveTool active={view === 'live'}>
          <ErgLiveView
            plannedSessions={plannedSessions}
            onSessionSaved={() => {
              navigate('progress/history');
              fetchSessions();
            }}
          />
        </LiveTool>

        <ErrorBoundary key={route.path}>
          {/* Inside the boundary, so a lazy chunk that fails to load or a
              tab that throws on first render is still caught and reported.
              The fallback is null on purpose: a tab is a full-page swap, and
              a spinner appearing for the ~1 frame a cached chunk takes reads
              as a flicker. React.lazy resolves each module once, so only the
              first visit to a tab can suspend at all. */}
          <Suspense fallback={null}>
            {/* ── PLAN VIEW (today + future prescriptions from status='planned') ── */}
            {view === 'plan' && (
              <PlanView
                plannedSessions={plannedSessions}
                loggedKeys={loggedKeys}
                isWide={isWide}
                onLog={() => navigate('progress/history')}
              />
            )}

            {/* ── CALENDAR VIEW ── */}
            {view === 'calendar' && (
              <CalendarView
                loggedSessions={loggedSessions}
                plannedSessions={plannedSessions}
                cancelledSessions={cancelledSessions}
                dbStatus={dbStatus}
                isWide={isWide}
                onLog={() => navigate('progress/history')}
              />
            )}

            {/* ── OVERVIEW ── */}
            {view === 'overview' && (
              <OverviewView
                latest={latest}
                loadUnavailable={loadUnavailable}
                tsbColor={tsbColor}
                loadData={loadData}
                loggedSessions={loggedSessions}
                latestErg={latestErg}
                totalErgDist={totalErgDist}
                totalSessions={totalSessions}
                isWide={isWide}
                onOpenBody={() => navigate('body')}
                onOpenHistory={() => navigate('progress/history')}
              />
            )}

            {view === 'load' && (
              <LoadView
                onOpenHistory={() => navigate('progress/history')}
                onOpenTrain={() => navigate('train')}
              />
            )}

            {/* ── ERG VIEW ── */}
            {view === 'erg' && (
              <ErgView
                tsbNow={latest?.tsb ?? null}
                ctlNow={latest?.ctl ?? null}
                onLog={() => navigate('train')}
              />
            )}

            {/* ── STRENGTH VIEW ── */}
            {view === 'strength' && (
              <StrengthView
                strengthSessions={strengthSessions}
                onLog={() => navigate('train/logger')}
              />
            )}

            {/* ── MOBILITY VIEW ── */}
            {view === 'mobility' && <MobilityView />}

            {/* ── RECOVERY VIEW ── */}
            {view === 'recovery' && (
              <RecoveryView
                isWide={isWide}
                onOpenSettings={() => navigate('settings')}
              />
            )}

            {/* ── LOG VIEW ── */}
            {view === 'log' && (
              <LogView
                logDisplaySessions={logDisplaySessions}
                isWide={isWide}
                onSaved={fetchSessions}
              />
            )}

            {/* ── SETTINGS VIEW (integrations: Strava today, more later) ── */}
            {view === 'settings' && (
              <SettingsView onSynced={fetchSessions} notice={stravaNotice} />
            )}
          </Suspense>
        </ErrorBoundary>

        <div
          style={{
            marginTop: 16,
            padding: '12px 16px',
            background: THEME.surfaceAlt,
            border: `1px solid ${THEME.border}`,
            borderRadius: 6,
            fontSize: 10,
            color: THEME.textDim,
            textAlign: 'center',
            lineHeight: 1.7,
          }}
        >
          <Trans comment="Desktop footer hint. Concept2 and Fitbod are brand names: keep them.">
            Tap any session to expand · Share Concept2 links or Fitbod
            screenshots to log sessions
          </Trans>
        </div>
      </div>
    </div>
  );
}
