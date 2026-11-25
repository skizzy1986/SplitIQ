import {
  MOVEMENT_ROUTES,
  canonicalMovementUrl,
  movementForPath,
} from '../movementRoute.js';
// The hash grammar moved to squat/utils/squatHash.js; its tests went with it.

describe('movementForPath', () => {
  it.each([
    ['/squat', 'squat'],
    ['/squat/', 'squat'],
    ['/row', 'row'],
    ['/row/', 'row'],
  ])('%s is the %s tool', (path, movement) => {
    expect(movementForPath(path)).toBe(movement);
  });

  it.each([
    '/',
    '',
    '/squats',
    '/squat/extra',
    '/squat//',
    '/SQUAT',
    '/rows',
    '/row/extra',
    '/ROW',
    '/__proto__',
    '/constructor',
    '/toString',
  ])('%s is no movement: the dashboard', (path) => {
    expect(movementForPath(path)).toBeNull();
  });

  it('is a frozen literal table, one route per movement', () => {
    expect(MOVEMENT_ROUTES).toEqual({ '/squat': 'squat', '/row': 'row' });
    expect(Object.isFrozen(MOVEMENT_ROUTES)).toBe(true);
  });
});

describe('canonicalMovementUrl', () => {
  it.each(['/squat', '/row'])(
    'drops the trailing slash from %s/ and keeps query and hash',
    (route) => {
      expect(
        canonicalMovementUrl({
          pathname: `${route}/`,
          search: '?a=1',
          hash: '#paused',
        })
      ).toBe(`${route}?a=1#paused`);
      expect(canonicalMovementUrl({ pathname: `${route}/` })).toBe(route);
    }
  );

  it('leaves every other path alone', () => {
    for (const pathname of ['/squat', '/row', '/', '/rows/', '/row/extra/']) {
      expect(canonicalMovementUrl({ pathname }), pathname).toBeNull();
    }
  });
});
