// The squat page's address and the words a browser tab and a search result
// show for it. Read through movements/squat/movement.js by SquatApp.jsx.
// RouteRoot and utils/movementRoute.js keep their own '/squat' literal: they
// run on the dashboard's first paint and must not reach into the tool's chunk.
// movement.test.js pins that the two agree.
export const ROUTE_PATH = '/squat';

export const PAGE_TITLE = 'High-bar squat — SplitIQ';
export const PAGE_DESCRIPTION =
  'An interactive coaching model of the high-bar back squat: the five phases, what to look for, common faults and cues, and form targets from published research.';
