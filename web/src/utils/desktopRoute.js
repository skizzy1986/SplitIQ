import { sessionIdFromHash } from './sessionPage.js';

// Desktop panes share mobile's destination ids; only the analytical subroutes
// belong here. Hash URLs work on both web reloads and Capacitor.
export const DESKTOP_PANES = {
  today: ['overview', 'calendar'],
  train: ['plan', 'live', 'logger', 'mobility'],
  progress: ['load', 'erg', 'strength', 'history'],
  body: ['recovery'],
};

const LEGACY = {
  overview: 'today',
  calendar: 'today/calendar',
  plan: 'train',
  live: 'train/live',
  logger: 'train/logger',
  mobility: 'train/mobility',
  erg: 'progress/erg',
  strength: 'progress/strength',
  log: 'progress/history',
  recovery: 'body',
};

export function desktopRoute(hash = '') {
  const requested = hash
    .replace(/^#?\/?/, '')
    .split('?')[0]
    .replace(/\/+$/, '');
  const path = Object.hasOwn(LEGACY, requested) ? LEGACY[requested] : requested;
  if (path === 'settings') return { destination: null, pane: 'settings', path };
  const sessionId = sessionIdFromHash(path);
  if (sessionId != null) {
    return {
      destination: null,
      pane: 'session',
      path: `session/${sessionId}`,
      sessionId,
    };
  }
  const [destination, requestedPane, extra] = path.split('/');
  const panes = Object.hasOwn(DESKTOP_PANES, destination)
    ? DESKTOP_PANES[destination]
    : null;
  if (!panes || extra || (requestedPane && !panes.includes(requestedPane))) {
    return { destination: 'today', pane: 'overview', path: 'today' };
  }
  const pane = requestedPane ?? panes[0];
  return {
    destination,
    pane,
    path: pane === panes[0] ? destination : `${destination}/${pane}`,
  };
}
