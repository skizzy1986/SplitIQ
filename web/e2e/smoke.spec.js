import { test, expect } from '@playwright/test';
import {
  installAppFixtures,
  clickAndSettle,
  stubSessionPage,
  SESSION_FIXTURE_ID,
  SESSION_FIXTURE_LABEL,
} from './fixtures.js';
import { DEFAULT_THEME } from '../src/constants/themeValues.js';

// Derived from the palette, not typed. This assertion used to carry a literal
// rgb(0, 212, 255) and had to be hand-edited by the light flip (#251); reading
// the token means it asserts the *role* and survives the next palette change.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const ACCENT_RGB = rgb(DEFAULT_THEME.accent);

// Every existing desktop surface remains reachable through the four destinations.
const TABS = [
  ['overview', 'Today', 'Overview'],
  ['calendar', 'Today', 'Calendar'],
  ['plan', 'Train', 'Plan'],
  ['live', 'Train', 'Live'],
  ['logger', 'Train', 'Logger'],
  ['mobility', 'Train', 'Mobility'],
  ['load', 'Progress', 'Load'],
  ['erg', 'Progress', 'Erg'],
  ['strength', 'Progress', 'Strength'],
  ['history', 'Progress', 'History'],
  ['recovery', 'Body', null],
  ['settings', 'Settings', null],
];

// The ErrorBoundary fallback in App.jsx renders this sentence when a
// view crashes on render. Its absence is the "mounted without error" signal.
const ERROR_BOUNDARY_TEXT = 'hit a render error';

test.describe('dashboard smoke', () => {
  let consoleErrors;

  test.beforeEach(async ({ page, context }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await installAppFixtures(context);
    await page.goto('/');
    // The splash plays on desktop too and overlays the nav for up to its
    // 5000ms ceiling, and toBeVisible() ignores occlusion. AuthGate is lazy, so
    // wait for the splash to mount first (a count-0 check made before it does
    // would pass at once), then for it to clear. The explicit 10 s clears the
    // 5 s ceiling whatever the config's expect default is. The seeded session
    // resolves getSession, so the splash always mounts here.
    await expect(page.locator('.siq-splash')).toHaveCount(1);
    await expect(page.locator('.siq-splash')).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test('app gets past the auth gate and shows the dashboard nav', async ({
    page,
  }) => {
    // The login screen would show a SIGN IN button; the dashboard shows the nav.
    await expect(
      page.getByRole('button', { name: 'Today', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'SIGN IN' })).toHaveCount(0);
  });

  for (const [tab, destination, pane] of TABS) {
    test(`tab "${tab}" mounts without error`, async ({ page }) => {
      const navButton = page.getByRole('button', {
        name: destination,
        exact: true,
      });
      await expect(navButton).toBeVisible();

      // Every view is a lazy chunk (#331), so the click only STARTS a fetch.
      // Both assertions below are absence-checks, and an absence-check passes
      // trivially against a view that has not mounted yet — without this wait
      // the whole suite would go green while proving nothing.
      // waitForLoadState('networkidle') was a no-op here (the state is reached
      // once per document, at load), so wait for the click's own requests.
      await clickAndSettle(page, navButton);
      if (pane)
        await clickAndSettle(
          page,
          page.getByRole('button', { name: pane, exact: true })
        );

      // The active tab button is highlighted with the accent border colour.
      await expect(navButton).toHaveCSS('border-top-color', ACCENT_RGB);

      // No error-boundary fallback rendered.
      await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);

      // No console errors / uncaught exceptions during mount.
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    });
  }
  test('desktop pane URLs survive reload, Back/Forward and Settings return', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(page).toHaveURL(/#\/today\/calendar$/);
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Calendar', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Train', exact: true }).click();
    await expect(page).toHaveURL(/#\/train$/);
    await page.goBack();
    await expect(
      page.getByRole('button', { name: 'Calendar', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    await page.goForward();
    await expect(
      page.getByRole('button', { name: 'Plan', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/#\/train$/);
    await expect(
      page.getByRole('button', { name: 'Settings', exact: true })
    ).toBeFocused();
  });

  test('a session URL opens the page, survives reload, and Back leaves it', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await page.evaluate(() => {
      window.location.hash = '#/session/1';
    });
    // The stub has no row 1, so the page shows its not-found state.
    await expect(
      page.getByRole('heading', { level: 1, name: 'Session not found' })
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/session\/1$/);
    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Session not found' })
    ).toBeVisible();
    await expect(page).toHaveURL(/#\/session\/1$/);
    // Reached by a reload, so Back goes to History rather than out of the app.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/#\/progress\/history$/);
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('a malformed session URL canonicalises to Today', async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = '#/session/abc';
    });
    await expect(page).toHaveURL(/#\/today$/);
    await expect(
      page.getByRole('button', { name: 'Today', exact: true })
    ).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('session page with a synthetic trace', () => {
  test('draws the trace and returns with Back', async ({ page, context }) => {
    const consoleErrors = [];
    page.on('pageerror', (err) => consoleErrors.push(String(err)));
    await installAppFixtures(context);
    await stubSessionPage(context);
    await page.goto('/');
    await expect(page.locator('.siq-splash')).toHaveCount(1);
    await expect(page.locator('.siq-splash')).toHaveCount(0, {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await page.evaluate((id) => {
      window.location.hash = `#/session/${id}`;
    }, SESSION_FIXTURE_ID);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Synthetic steady row' })
    ).toBeVisible();
    await expect(page.getByRole('img', { name: /^Pace across/ })).toBeVisible();
    await expect(
      page.locator('.recharts-responsive-container').first()
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'View on Strava' })
    ).toBeVisible();
    // Opened from inside the app: Back pops history to where it came from.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/#\/progress$/);
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('hovering the trace shows a tooltip on each chart, each with its own series', async ({
    page,
    context,
  }) => {
    await openWithSessionRow(page, context);
    await page.evaluate((id) => {
      window.location.hash = `#/session/${id}`;
    }, SESSION_FIXTURE_ID);
    const pace = page.getByRole('img', { name: /^Pace across/ });
    await expect(pace).toBeVisible();
    const surface = pace.locator('.recharts-surface');
    const box = await surface.boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
    const tips = page.locator('.recharts-tooltip-wrapper');
    await expect(tips).toHaveCount(3);
    // Synced by index: every chart's tooltip is up at the same instant.
    for (let i = 0; i < 3; i += 1) {
      await expect(tips.nth(i)).toBeVisible();
    }
    const texts = await tips.allInnerTexts();
    // Value and unit are joined by a non-breaking space, which `\s` matches.
    expect(texts[0]).toMatch(/Pace[\s\S]*\/500\sm[\s\S]*Power[\s\S]*W/);
    expect(texts[1]).toMatch(/Heart rate[\s\S]*bpm/);
    expect(texts[2]).toMatch(/Stroke rate[\s\S]*spm/);
    // The same instant on all three.
    const time = (t) => t.split('\n')[0].trim();
    expect(time(texts[1])).toBe(time(texts[0]));
    expect(time(texts[2])).toBe(time(texts[0]));
    // Each series once: heart rate only on its own chart, and so on.
    expect(texts[0]).not.toMatch(/bpm|spm/);
    expect(texts[1]).not.toMatch(/\/500\sm|spm/);
    expect(texts[2]).not.toMatch(/\/500\sm|bpm/);
    // A local look at the result, never committed.
    if (process.env.SESSION_SHOT_DIR) {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await pace.scrollIntoViewIfNeeded();
      const again = await surface.boundingBox();
      await page.mouse.move(
        again.x + again.width * 0.4,
        again.y + again.height / 2
      );
      await expect(tips.nth(2)).toBeVisible();
      await page.screenshot({
        path: `${process.env.SESSION_SHOT_DIR}/hover.png`,
      });
    }
  });

  test('desktop: a History row opens its page, and Back returns focus to that link', async ({
    page,
    context,
  }) => {
    await openWithSessionRow(page, context);
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await clickAndSettle(
      page,
      page.getByRole('button', { name: 'History', exact: true })
    );
    const link = page.getByRole('link', {
      name: `Open the session page for ${SESSION_FIXTURE_LABEL}`,
    });
    await link.click();
    await expect(page).toHaveURL(
      new RegExp(`#/session/${SESSION_FIXTURE_ID}$`)
    );
    await expect(
      page.getByRole('heading', { level: 1, name: SESSION_FIXTURE_LABEL })
    ).toBeFocused();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/#\/progress\/history$/);
    await expect(link).toBeFocused();
  });

  test('desktop: session, then Settings, then Back returns to the session', async ({
    page,
    context,
  }) => {
    await openWithSessionRow(page, context);
    await page.evaluate((id) => {
      window.location.hash = `#/session/${id}`;
    }, SESSION_FIXTURE_ID);
    await expect(
      page.getByRole('heading', { level: 1, name: SESSION_FIXTURE_LABEL })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`#/session/${SESSION_FIXTURE_ID}$`)
    );
    await expect(
      page.getByRole('heading', { level: 1, name: SESSION_FIXTURE_LABEL })
    ).toBeVisible();
  });
});

test.describe('session page on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a History row opens its page, and Back returns to History with focus on the row', async ({
    page,
    context,
  }) => {
    await openWithSessionRow(page, context);
    await page.getByRole('button', { name: 'Progress', exact: true }).click();
    await clickAndSettle(
      page,
      page.getByRole('button', { name: 'History', exact: true })
    );
    const row = page.getByRole('link', {
      name: new RegExp(SESSION_FIXTURE_LABEL),
    });
    await row.click();
    await expect(
      page.getByRole('heading', { level: 1, name: SESSION_FIXTURE_LABEL })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page).toHaveURL(/#\/progress$/);
    // Back lands on the History pane it was opened from, focus on the row.
    await expect(
      page.getByRole('button', { name: 'History', exact: true })
    ).toHaveAttribute('aria-current', 'page');
    await expect(row).toBeFocused();
  });
});

async function openWithSessionRow(page, context) {
  await installAppFixtures(context);
  await stubSessionPage(context, SESSION_FIXTURE_ID, { inList: true });
  await page.goto('/');
  await expect(page.locator('.siq-splash')).toHaveCount(1);
  await expect(page.locator('.siq-splash')).toHaveCount(0, {
    timeout: 10_000,
  });
}
