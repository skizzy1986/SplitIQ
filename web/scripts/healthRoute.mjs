// Health tables never touch Cache Storage (#417, decision 5). Nothing clears
// the service worker's caches on sign-out, so a cached REST response would sit
// on the device after the session ends.
//
// Workbox (workbox-routing 7.x, RegExpRoute) only matches a cross-origin URL
// when the match starts at index 0 of the full href, hence the leading
// ^https://. Without the anchor the route would silently never fire on the
// Supabase origin.
//
// There is no generic Supabase cache (#526). The previous NetworkFirst rule
// used an unanchored pattern, so it never matched, and turning it on would
// keep authenticated rows after sign-out. This route stays NetworkOnly so
// these three tables are explicit, and it is registered before any later
// cache rule: Workbox serves the first matching route.
export const HEALTH_TABLES = ['bp_readings', 'lab_results', 'injuries'];

export const HEALTH_NETWORK_ONLY_ROUTE = {
  urlPattern:
    /^https:\/\/[^/]+\.supabase\.co\/rest\/v1\/(bp_readings|lab_results|injuries)(\?|\/|$)/,
  handler: 'NetworkOnly',
};
