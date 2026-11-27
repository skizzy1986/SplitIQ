// Visual regression baselines for the app shell (#249, design slice S6.0).
//
// WHAT THIS COVERS: shell and chrome only — the desktop nav, the mobile bottom
// tab bar, headers, section labels, card and form primitives, the login screen
// and ErrorFallback. It exists so the palette rename can prove it moved no
// pixels and the S6 spacing pass has something that catches drift.
//
// WHAT THIS DOES NOT COVER, and nobody should read it as covering:
//   - Data. The fixtures stub Supabase to `[]`, so every interior renders as an
//     empty state. Content fixtures are a later issue. The one exception is
//     the session page, which renders one synthetic row and trace from
//     stubSessionPage (fixtures.js).
//   - Chart internals. Every `.recharts-responsive-container` is masked (see
//     below), so S6 cannot lean on these baselines for chart layout. The mask
//     tracks the container's bounding box, so container geometry IS still
//     covered — what is lost is everything drawn inside it.
//   - Desktop plan/live/erg/strength/logger/mobility/recovery/log, mobile
//     erg, StrengthLogger entirely, and every hover, focus and expanded
//     state.
//
// The public movement tools, /squat and /row, are at the foot of the file (#828).
// They are not the dashboard: no fixtures, no pinned clock, and the canvas on
// /squat is masked (see the note there).
//
// WHY THE CLOCK IS PINNED: OverviewView, CalendarView, MobileAnalytics and
// MobileRecovery all render `new Date()`. Unpinned, every baseline rots at
// midnight.
//
// WHY THE CHARTS ARE MASKED: .design-sync/NOTES.md records that a pinned clock
// stalls Recharts' react-smooth line-draw part-way through, and that it cannot
// be disabled from outside because PaceTrendChart hardcodes <Line> without
// isAnimationActive. The two constraints are complementary, not competing — the
// pinned clock is what makes the baselines stable across days, and the mask is
// what makes its one known side effect harmless.
//
// BASELINES ARE GENERATED IN THE CI PLAYWRIGHT CONTAINER, never on a dev
// machine — glyph rasterisation differs and a locally-generated baseline fails
// forever. Dispatch `E2E — Web` on your branch with `update_baselines: true` and
// it regenerates them and commits them to that branch (#288); reviewing the
// resulting PNG diff on the PR is where "is this right?" gets decided. The
// equivalent by hand, if you have a Docker daemon:
//   docker run --rm -v "$PWD":/repo -w /repo/web -e HOME=/root -e CI=1 \
//     mcr.microsoft.com/playwright:v1.62.1-noble \
//     sh -c "npm ci && npm run test:visual:update"
//
// That form is POSIX-shell only. Under Git Bash on Windows, MSYS rewrites the
// container-side `/repo` into a Windows path before Docker ever sees it, so the
// mount lands somewhere unintended — and `$PWD` compounds it when the checkout
// path contains a space. Turn the rewriting off and pass a native path, quoting
// the whole -v argument so the space survives:
//   MSYS_NO_PATHCONV=1 docker run --rm -v "C:\path\to\erg-dashboard:/repo" \
//     -w /repo/web -e HOME=/root -e CI=1 \
//     mcr.microsoft.com/playwright:v1.62.1-noble \
//     sh -c "npm ci && npm run test:visual:update"

import { test, expect } from '@playwright/test';
import {
  installAppFixtures,
  stubSupabase,
  seedSession,
  clickAndSettle,
  stubSessionPage,
  SESSION_FIXTURE_ID,
  SESSION_FIXTURE_LABEL,
} from './fixtures.js';

// Monday 15 June 2026, midday UTC — mid-week, mid-month, and far enough from
// either midnight that no timezone rounding can flip the calendar day.
const FIXED_TIME = Date.UTC(2026, 5, 15, 12);

function chartMask(page) {
  return [page.locator('.recharts-responsive-container')];
}

async function shot(page, name) {
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: chartMask(page) });
}

async function openAuthed(page, context) {
  await installAppFixtures(context, { now: FIXED_TIME });
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto('/');
  // AuthGate is lazy behind RouteRoot (#383), so straight after goto there is
  // no splash YET and the count-0 check below would pass before it mounts —
  // the baseline then captures the splash. Let the shell's chunks land first.
  await page.waitForLoadState('networkidle');
  // The splash overlays the tab tree, and toBeVisible() ignores
  // occlusion, so every baseline would capture the splash instead. The
  // explicit 10 s timeout clears the 5 s splash ceiling whatever the config's
  // expect default is.
  await expect(page.locator('.siq-splash')).toHaveCount(0, { timeout: 10_000 });
}

// Tab switching is state-only (App.jsx and MobileApp.jsx both hold `view` in
// useState — there is no routing), and the active-tab styling is a colour on
// desktop and a font-weight on mobile. Both of those properties are owned by
// other design workstreams, so settling on "the rendered tree changed" keeps
// this harness from breaking when they move.
async function switchTo(page, button) {
  const root = page.locator('#root');
  const before = await root.innerHTML();
  // Every tab is behind React.lazy with `fallback={null}` (App.jsx:402), so a
  // changed #root does NOT prove the new tab rendered. #root innerHTML length
  // at each stage of a PROGRAM switch:
  //
  //   before click 42989 -> nav highlighted 43219 -> chunk loaded 73883
  //
  // Screenshotting at the middle stage captures the outgoing tab plus a
  // highlighted nav button — a 17%-of-pixels diff against the baseline. This
  // used to wait on waitForLoadState('networkidle'), which resolves at once
  // here (the state was already reached in openAuthed), so the race decided
  // the result: identical code passed and failed three minutes apart on
  // 2026-11-05. clickAndSettle waits for the chunk the click actually
  // requested. The visual project keeps retries:0 so a race cannot hide.
  await clickAndSettle(page, button);
  await expect
    .poll(async () => (await root.innerHTML()) !== before, { timeout: 10_000 })
    .toBe(true);
}

test.describe('desktop shell', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // Reached by clicking the nav button's visible text — there are no test ids
  // in web/src, and adding one would put this PR on the wrong side of the
  // property boundary it exists to protect.
  const nav = (page, label) =>
    page.getByRole('button', { name: label, exact: true });

  test('overview', async ({ page, context }) => {
    await openAuthed(page, context);
    await expect(nav(page, 'Today')).toBeVisible();
    await shot(page, 'desktop-overview');
  });

  test('calendar', async ({ page, context }) => {
    await openAuthed(page, context);
    const calendar = page.getByRole('button', {
      name: 'Calendar',
      exact: true,
    });
    await expect(calendar).toBeVisible();
    await switchTo(page, calendar);
    await shot(page, 'desktop-calendar');
  });

  // ErrorFallback renders only from the Sentry boundary in main.jsx, which
  // wraps AuthGate — the inner ErrorBoundary in App.jsx catches per-tab crashes
  // with its own message, so no tab can reach it. useIsMobile()'s useState
  // initializer is the one render-phase call above that boundary, and
  // window.matchMedia is its only dependency.
  test('error fallback', async ({ page, context }) => {
    await stubSupabase(context);
    await seedSession(context, FIXED_TIME);
    await context.addInitScript(() => {
      window.matchMedia = () => {
        throw new Error('e2e: forced render error');
      };
    });
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto('/');
    await expect(page.getByRole('alert')).toBeVisible();
    await shot(page, 'error-fallback');
  });
});

test.describe('mobile shell', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // 390 < 767, so useIsMobile matches and main.jsx mounts MobileApp — an
  // entirely different component tree, which is why these shots are not
  // optional. BottomTabBar buttons hold an icon span and a label span, so the
  // accessible name is the icon plus the label. Exact matching keeps the
  // destination distinct from empty-state actions such as "Open Train".
  const tab = (page, label) =>
    page.getByRole('button', { name: label, exact: true });

  test('today', async ({ page, context }) => {
    await openAuthed(page, context);
    await expect(tab(page, 'Today')).toBeVisible();
    await shot(page, 'mobile-today');
  });

  test('train', async ({ page, context }) => {
    await openAuthed(page, context);
    await switchTo(page, tab(page, 'Train'));
    await shot(page, 'mobile-train');
  });

  test('progress', async ({ page, context }) => {
    await openAuthed(page, context);
    await switchTo(page, tab(page, 'Progress'));
    await shot(page, 'mobile-progress');
  });

  test('body', async ({ page, context }) => {
    await openAuthed(page, context);
    await switchTo(page, tab(page, 'Body'));
    await shot(page, 'mobile-body');
  });
});

// The session page (#648) against the synthetic stub in fixtures.js: one
// completed erg row and a synthetic trace, nothing real. The charts are
// masked like every other chart here; the summary tiles, headline, zone and
// provenance text and the page chrome are what these baselines hold.
async function openSession(page, context) {
  await installAppFixtures(context, { now: FIXED_TIME });
  await stubSessionPage(context, SESSION_FIXTURE_ID);
  await page.clock.setFixedTime(FIXED_TIME);
  await page.goto(`/#/session/${SESSION_FIXTURE_ID}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.siq-splash')).toHaveCount(0, { timeout: 10_000 });
  await expect(
    page.getByRole('heading', { level: 1, name: SESSION_FIXTURE_LABEL })
  ).toBeVisible();
  // The trace is the last thing to arrive: wait for its first chart.
  await expect(page.getByRole('img', { name: /^Pace across/ })).toBeVisible();
}

test.describe('session page', () => {
  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test('session', async ({ page, context }) => {
      await openSession(page, context);
      await shot(page, 'desktop-session');
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('session', async ({ page, context }) => {
      await openSession(page, context);
      await shot(page, 'mobile-session');
    });
  });
});

test.describe('login', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  // No seeded session: the auth gate falls through to main.jsx's own Login
  // form, the only surface covering its input and button primitives.
  test('signed out', async ({ page, context }) => {
    await stubSupabase(context);
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'SIGN IN' })).toBeVisible();
    await shot(page, 'login');
  });
});

// The movement tools (#828): /squat once its status reads "3D model ready", and
// the /row placeholder, at the three viewports every rowing slice reports its
// evidence at. Like the tool specs these use no fixtures, because the tools have
// no auth gate and must never touch Supabase; each shot fails on any request
// that is not to the preview's own origin.
// Service workers are blocked so every request is the page's own and visible to
// page.on('request'). The clock is not pinned: neither page renders a date.
//
// WHY THE /squat CANVAS IS MASKED, NOT TOLERATED: the model is drawn through
// SwiftShader, a software rasteriser whose output is a property of the runner's
// CPU and driver build, not of this repo. Byte-identical on one machine (PR #814)
// does not promise byte-identical on the next CI host. A tolerance is the wrong
// tool for that: toHaveScreenshot's threshold and maxDiffPixels are per-shot, so
// one wide enough to absorb a rasteriser difference is just as wide over the
// page chrome beside the canvas, and #291 is the record of a loose comparator
// silently admitting a whole-viewport repaint. A mask costs nothing else: the
// comparator stays at threshold 0 for every pixel outside the canvas (the
// header, the muscle list, the controls, the footer), and what the canvas itself
// draws is covered by assertions that do not read pixels (the load status, the
// scene host holding one visible canvas) here and by squat.spec.js.
// The mask tracks the canvas's bounding box, so the stage's geometry is still
// pinned.
const TOOL_SHOTS = [
  {
    label: 'desktop light 1440x900',
    name: 'desktop-light',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
  {
    label: 'desktop dark 1280x820',
    name: 'desktop-dark',
    viewport: { width: 1280, height: 820 },
    colorScheme: 'dark',
  },
  {
    label: 'phone light 390x844',
    name: 'phone-light',
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
  },
];

// Fails the shot if the page made a request that left its own origin, which
// covers Supabase as well as fonts, analytics and anything else.
function recordRequests(page) {
  const urls = [];
  page.on('request', (req) => urls.push(req.url()));
  return urls;
}

function offOrigin(page, urls) {
  const origin = new URL(page.url()).origin;
  return urls.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin);
}

const supabaseHits = (urls) =>
  urls.filter((u) => /(^|\.)supabase\.co(:\d+)?$/.test(new URL(u).hostname));

// Headless Chromium has no GPU; WebGL falls back to SwiftShader only when this
// flag allows it. The same flag squat.spec.js launches with. Playwright refuses
// launchOptions inside a describe (it forces a new worker), so it is file-wide
// and the dashboard shots launch with it too. It only permits a WebGL fallback,
// which the dashboard never asks for; the dashboard baselines are compared at
// threshold 0 on CI, so any effect would show there.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader'] } });

const TOOL_LOAD_TIMEOUT = 45_000;

test.describe('/squat', () => {
  test.use({ serviceWorkers: 'block' });
  test.setTimeout(90_000);

  for (const shotSpec of TOOL_SHOTS) {
    test.describe(shotSpec.label, () => {
      test.use({
        viewport: shotSpec.viewport,
        colorScheme: shotSpec.colorScheme,
      });

      test('squat', async ({ page }) => {
        const urls = recordRequests(page);
        const errors = [];
        page.on('pageerror', (err) => errors.push(String(err)));
        await page.goto('/squat', { timeout: TOOL_LOAD_TIMEOUT });
        await expect(
          page.getByRole('heading', { level: 1, name: 'High-bar back squat' })
        ).toBeVisible({ timeout: TOOL_LOAD_TIMEOUT });
        // Fetch, gunzip, three.js chunk, scene build, first frame. The status
        // region stays mounted, visually hidden, once the model is drawn.
        await expect(page.getByTestId('load-status')).toHaveText(
          /3D model ready/,
          { timeout: TOOL_LOAD_TIMEOUT }
        );
        // The progress bar is gone once the model is drawn: nothing is mid-
        // transition under the mask.
        await expect(page.getByTestId('load-bar')).toHaveCount(0);
        // Stable assertions on the page around the canvas.
        const canvas = page.locator('[data-testid="scene-host"] canvas');
        await expect(canvas).toHaveCount(1);
        await expect(canvas).toBeVisible();
        await expect(page.locator('[data-theme]').first()).toHaveAttribute(
          'data-theme',
          shotSpec.colorScheme
        );

        await expect(page).toHaveScreenshot(`squat-${shotSpec.name}.png`, {
          mask: [canvas],
        });

        expect(supabaseHits(urls)).toEqual([]);
        expect(offOrigin(page, urls)).toEqual([]);
        expect(errors).toEqual([]);
      });
    });
  }
});

test.describe('/row', () => {
  test.use({ serviceWorkers: 'block' });

  for (const shotSpec of TOOL_SHOTS) {
    test.describe(shotSpec.label, () => {
      test.use({
        viewport: shotSpec.viewport,
        colorScheme: shotSpec.colorScheme,
      });

      // /row is static today, so the whole page is compared, nothing masked.
      // When #760 replaces the placeholder, that PR refreshes these baselines.
      test('row', async ({ page }) => {
        const urls = recordRequests(page);
        const errors = [];
        page.on('pageerror', (err) => errors.push(String(err)));
        await page.goto('/row', { timeout: TOOL_LOAD_TIMEOUT });
        await expect(
          page.getByRole('heading', { level: 1, name: 'Rowing stroke' })
        ).toBeVisible({ timeout: TOOL_LOAD_TIMEOUT });
        await expect(page.getByTestId('row-root')).toHaveAttribute(
          'data-theme',
          shotSpec.colorScheme
        );

        await expect(page).toHaveScreenshot(`row-${shotSpec.name}.png`);

        expect(supabaseHits(urls)).toEqual([]);
        expect(offOrigin(page, urls)).toEqual([]);
        expect(errors).toEqual([]);
      });
    });
  }
});
