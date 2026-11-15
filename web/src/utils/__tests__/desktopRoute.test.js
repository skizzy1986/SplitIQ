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
  ])('resolves %s to %s', (hash, path, pane) => {
    expect(desktopRoute(hash)).toMatchObject({ path, pane });
  });
});
