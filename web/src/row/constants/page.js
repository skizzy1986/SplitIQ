// The row page's address and the words a browser tab and a search result
// show for it. RouteRoot and utils/movementRoute.js keep their own '/row'
// literal: they run on the dashboard's first paint and must not reach into
// the tool's chunk. row/__tests__/route.test.js pins that the two agree.
export const ROUTE_PATH = '/row';

export const PAGE_TITLE = 'Rowing stroke — SplitIQ';
export const PAGE_DESCRIPTION =
  'The rowing stroke, modelled in 3D. Not ready yet.';

// What /row says until the model lands (#760).
export const PLACEHOLDER = {
  heading: 'Rowing stroke',
  body: 'The 3D model of the rowing stroke is being built. It is not ready yet.',
  squatLink: 'Open the squat model',
  squatHref: '/squat',
};
