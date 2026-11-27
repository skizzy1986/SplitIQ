// Shared setup for the e2e specs: get past the Supabase auth gate and keep the
// app off the network.
//
// Auth gate: main.jsx renders the dashboard only when supabase.auth.getSession()
// returns a session. supabase-js reads it from localStorage under
// `sb-<project-ref>-auth-token` and, for an unexpired token, returns it without
// any network call (verified in @supabase/auth-js __loadSession). The preview
// build uses VITE_SUPABASE_URL=https://test-project.supabase.co (see
// playwright.config.js), so the project ref is `test-project`.
//
// Plain helpers rather than an extended `test`: smoke.spec.js also wires
// console-error listeners that the visual spec has no use for, and visual.spec.js
// pins the browser clock, which smoke must not do.

import { expect } from '@playwright/test';

export const STORAGE_KEY = 'sb-test-project-auth-token';

// `nowMs` is a parameter because visual.spec.js pins the browser clock — the
// session has to read as unexpired relative to the *pinned* time, or supabase-js
// tries to refresh it against a stub that answers `[]`.
export function fakeSession(nowMs = Date.now()) {
  const expiresAt = Math.floor(nowMs / 1000) + 60 * 60 * 24; // +24h
  return {
    access_token: 'e2e-fake-access-token',
    refresh_token: 'e2e-fake-refresh-token',
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: expiresAt,
    user: {
      id: '00000000-0000-0000-0000-000000000000',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'e2e@example.com',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

// Stub all Supabase REST/auth traffic so no real backend is needed and the
// app's data fetches resolve cleanly with empty results.
export async function stubSupabase(context) {
  await context.route(/test-project\.supabase\.co\/.*/, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });
  // A signed-in tester who has already chosen a heart-rate path. Without a row
  // the app asks the new-account question (#819), over every screen the specs
  // photograph. The route added last wins, so this sits after the catch-all.
  await context.route(
    /test-project\.supabase\.co\/rest\/v1\/user_training_settings/,
    (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          user_id: '00000000-0000-0000-0000-000000000000',
          hr_path: 'rpe',
          hr_path_chosen_on: '2026-01-01',
          birth_year: null,
          time_zone: null,
          base_block_started_on: null,
          screening_completed_on: null,
          hr_caution: false,
          depth: 'simple',
        }),
      });
    }
  );
}

// Seed the fake session before any app code runs so the auth gate passes.
export async function seedSession(context, nowMs) {
  await context.addInitScript(
    ([key, session]) => {
      window.localStorage.setItem(key, JSON.stringify(session));
    },
    [STORAGE_KEY, fakeSession(nowMs)]
  );
}

// Click something that lazy-loads (every tab is a React.lazy chunk) and wait
// until the requests that click started have finished and the network has
// been quiet for `quietMs`.
//
// page.waitForLoadState('networkidle') cannot do this: a load state is
// reached once per document, and "if the state has been already reached
// while loading current document, the method resolves immediately"
// (Playwright docs, page.waitForLoadState). A tab switch is not a
// navigation, so after the first settle it returned at once and every
// screenshot or absence-check raced the chunk. Measured with the PROGRAM
// chunk delayed 1.5 s: #root was 43,401 chars after that wait, 73,883 once
// the tab arrived. Listeners go on BEFORE the click so the chunk request
// cannot slip past them.
export async function clickAndSettle(
  page,
  target,
  { quietMs = 500, timeout = 10_000 } = {}
) {
  const inflight = new Set();
  let lastActivity = Date.now();
  const start = (req) => {
    inflight.add(req);
    lastActivity = Date.now();
  };
  const end = (req) => {
    inflight.delete(req);
    lastActivity = Date.now();
  };
  page.on('request', start);
  page.on('requestfinished', end);
  page.on('requestfailed', end);
  try {
    await target.click();
    await expect
      .poll(() => inflight.size === 0 && Date.now() - lastActivity >= quietMs, {
        timeout,
        intervals: [100],
        message: `network did not go quiet for ${quietMs}ms after the click`,
      })
      .toBe(true);
  } finally {
    page.off('request', start);
    page.off('requestfinished', end);
    page.off('requestfailed', end);
  }
}

// The session page against synthetic data: one completed erg row for
// `sessionId` and a `strava-activity` answer with a 20-minute trace. Every
// number is invented. Registered after stubSupabase, so it wins for these
// URLs (Playwright runs matching routes newest first). With `inList`, every
// other sessions read (the History lists) also returns the row, so a real
// session link renders.
export const SESSION_FIXTURE_ID = 2;
export const SESSION_FIXTURE_LABEL = 'Synthetic steady row';
export async function stubSessionPage(
  context,
  sessionId = SESSION_FIXTURE_ID,
  { inList = false } = {}
) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  };
  const row = {
    id: sessionId,
    user_id: '00000000-0000-0000-0000-000000000000',
    date: '6/14/26',
    date_iso: '2026-06-14',
    type: 'erg',
    label: SESSION_FIXTURE_LABEL,
    duration: '20:00',
    srpe: 5,
    prs: null,
    exercises: null,
    coach_note: null,
    status: 'completed',
    distance_m: 4800,
    avg_watts: 180,
    avg_hr: 140,
    source: 'strava',
    strava_activity_id: 1000001,
  };
  // `[?&]id=` so `user_id=eq.…` never matches as the row id.
  const byId = new RegExp(`[?&]id=eq\\.${sessionId}(&|$)`);
  await context.route(
    /test-project\.supabase\.co\/rest\/v1\/sessions\?/,
    (route) => {
      const url = route.request().url();
      const hit = byId.test(url) || (inList && !/[?&]id=eq\./.test(url));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: cors,
        body: JSON.stringify(hit ? [row] : []),
      });
    }
  );
  const n = 1200;
  const time = Array.from({ length: n }, (_, i) => i);
  const body = {
    status: 'ok',
    cached: false,
    origin: 'inserted',
    strava_activity_id: 1000001,
    // Synthetic placeholder; the real function builds this URL server-side.
    url: 'https://activities.example.test/1000001',
    fetched_at: '2026-06-14T08:00:00Z',
    expires_at: '2026-06-20T08:00:00Z',
    activity: {
      sport_type: 'Rowing',
      device_name: 'Synthetic Monitor',
      elapsed_time_s: n,
      moving_time_s: n,
      distance_m: n * 4,
      total_elevation_gain_m: 0,
      calories: 200,
      device_watts: true,
      laps: [],
    },
    streams: {
      time,
      distance: time.map((i) => i * 4),
      watts: time.map((i) => 170 + (i % 40)),
      heartrate: time.map((i) => 125 + Math.floor(i / 60)),
      cadence: time.map(() => 22),
      velocity_smooth: time.map(() => 4),
      // Numbers, as the function sends them, with a 10 s pause at 10:00.
      moving: time.map((i) => (i >= 600 && i < 610 ? 0 : 1)),
    },
  };
  await context.route(
    /test-project\.supabase\.co\/functions\/v1\/strava-activity/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: cors,
        body: JSON.stringify(body),
      })
  );
}

export async function installAppFixtures(context, { now } = {}) {
  await stubSupabase(context);
  await seedSession(context, now);
}
