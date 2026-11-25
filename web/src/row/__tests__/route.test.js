import { ROUTE_PATH } from '../constants/page.js';
import {
  canonicalMovementUrl,
  movementForPath,
} from '../../utils/movementRoute.js';

// RouteRoot keeps its own '/row' (dashboard first paint); the two must agree.
describe('the row route', () => {
  it('is recognised by movementForPath, with and without the trailing slash', () => {
    expect(ROUTE_PATH).toBe('/row');
    expect(movementForPath(ROUTE_PATH)).toBe('row');
    expect(movementForPath(`${ROUTE_PATH}/`)).toBe('row');
    expect(canonicalMovementUrl({ pathname: ROUTE_PATH })).toBeNull();
    expect(
      canonicalMovementUrl({
        pathname: `${ROUTE_PATH}/`,
        search: '?a=1',
        hash: '#x',
      })
    ).toBe(`${ROUTE_PATH}?a=1#x`);
  });
});
