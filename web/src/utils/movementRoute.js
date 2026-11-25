// The public movement tools' addresses: /squat and /row. Kept here, outside
// every tool's folder, because RouteRoot reads them at first paint and must
// not pull a tool's chunk in to do so. A literal table rather than the build
// registry (scripts/movementAssets.mjs), so no build data reaches the first
// paint; the registry's test pins that the two agree. Each tool's own hash
// grammar lives with the tool (squat/utils/squatHash.js).

export const MOVEMENT_ROUTES = Object.freeze({
  '/squat': 'squat',
  '/row': 'row',
});

// Exact and case-sensitive, with or without one trailing slash: /rows,
// /row/extra and /ROW are the dashboard's. An own-property lookup, so
// /__proto__ or /constructor is never a movement.
export function movementForPath(pathname) {
  const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return Object.hasOwn(MOVEMENT_ROUTES, path) ? MOVEMENT_ROUTES[path] : null;
}

// /squat/ is served (vercel.json rewrites its relative asset URLs back to
// /assets/), then swapped for /squat in place before the window's load event,
// so the service worker registers at the root scope and the URL a visitor
// copies is the canonical one. The same for every movement. A replaceState,
// not a redirect: a redirect rule on the host risked a self-loop. Returns null
// when there is nothing to change.
export function canonicalMovementUrl({ pathname, search = '', hash = '' }) {
  if (!pathname.endsWith('/') || !movementForPath(pathname)) return null;
  return `${pathname.slice(0, -1)}${search}${hash}`;
}
