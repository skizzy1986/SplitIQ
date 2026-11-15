import { test, expect } from '@playwright/test';
import { installAppFixtures, clickAndSettle } from './fixtures.js';
import { DEFAULT_THEME } from '../src/constants/themeValues.js';

// Derived from the palette, not typed. This assertion used to carry a literal
// rgb(0, 212, 255) and had to be hand-edited by the light flip (#251); reading
// the token means it asserts the *role* and survives the next palette change.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const ACCENT_RGB = rgb(DEFAULT_THEME.accent);

// Every dashboard tab (matches the NAV in App.jsx). The strength logger is not
// a tab since #520; it opens from inside Strength (its own test, below).
const TABS = [
  'overview',
  'calendar',
  'plan',
  'live',
  'erg',
  'strength',
  'mobility',
  'recovery',
  'log',
  'settings',
];

// Label shown on each nav button is the tab key, uppercased.
const NAV_LABEL = (tab) => tab.toUpperCase();

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
      page.getByRole('button', { name: NAV_LABEL('overview'), exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'SIGN IN' })).toHaveCount(0);
  });

  for (const tab of TABS) {
    test(`tab "${tab}" mounts without error`, async ({ page }) => {
      const navButton = page.getByRole('button', {
        name: NAV_LABEL(tab),
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

      // The active tab button is highlighted with the accent border colour.
      await expect(navButton).toHaveCSS('border-top-color', ACCENT_RGB);

      // No error-boundary fallback rendered.
      await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);

      // No console errors / uncaught exceptions during mount.
      expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    });
  }

  // The real logger, mounted from Strength's primary action (#520). This is
  // the coverage the removed Logger tab's loop entry used to give.
  test('strength logger mounts from the Strength tab without error', async ({
    page,
  }) => {
    const navButton = page.getByRole('button', {
      name: NAV_LABEL('strength'),
      exact: true,
    });
    await expect(navButton).toBeVisible();
    await clickAndSettle(page, navButton);

    const logButton = page.getByRole('button', {
      name: /^(Log a session|Resume session)$/,
    });
    await expect(logButton).toBeVisible();
    await clickAndSettle(page, logButton);

    await expect(page.locator('.slog')).toBeVisible();
    await expect(page.getByText(ERROR_BOUNDARY_TEXT)).toHaveCount(0);
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});
