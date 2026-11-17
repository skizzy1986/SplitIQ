import { desktopRoute } from '../desktopRoute.js';

describe('desktopRoute', () => {
  it.each([
    ['', 'today', 'overview'],
    ['#/today', 'today', 'overview'],
    ['#/today/calendar', 'today/calendar', 'calendar'],
    ['#/train', 'train', 'plan'],
    ['#/train/logger', 'train/logger', 'logger'],
    ['#/progress', 'progress', 'load'],
    ['#/progress/history', 'progress/history', 'history'],
    ['#/body', 'body', 'recovery'],
    ['#/settings?strava=connected', 'settings', 'settings'],
    ['#/calendar', 'today/calendar', 'calendar'],
    ['#/log', 'progress/history', 'history'],
    ['#/today/nope', 'today', 'overview'],
    ['#/train/live/extra', 'today', 'overview'],
    ['#/progress/load', 'progress', 'load'],
    ['#/nope', 'today', 'overview'],
    ['#/today/', 'today', 'overview'],
    ['#/constructor', 'today', 'overview'],
    ['#/__proto__', 'today', 'overview'],
    ['#/toString', 'today', 'overview'],
    ['#/session/abc', 'today', 'overview'],
    ['#/session/0', 'today', 'overview'],
    ['#/session/012', 'today', 'overview'],
    ['#/session/12/extra', 'today', 'overview'],
    ['#/session', 'today', 'overview'],
    ['#/session/99999999999999999', 'today', 'overview'],
  ])('resolves %s to %s', (hash, path, pane) => {
    expect(desktopRoute(hash)).toMatchObject({ path, pane });
  });

  it('opens a session page from #/session/<id>, outside any destination', () => {
    expect(desktopRoute('#/session/123')).toEqual({
      destination: null,
      pane: 'session',
      path: 'session/123',
      sessionId: 123,
    });
    expect(desktopRoute('#/session/123/')).toMatchObject({ sessionId: 123 });
    expect(desktopRoute('#/session/7?x=1')).toMatchObject({ sessionId: 7 });
  });
});
