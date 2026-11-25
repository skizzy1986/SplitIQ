import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DARK, LIGHT } from '../src/constants/themeValues.js';
import {
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  PLACEHOLDER,
} from '../src/row/constants/page.js';
import { toolChunkUrlPattern } from '../scripts/movementAssets.mjs';

// The public /row placeholder (#756) against the built preview, until the
// rowing model replaces it (#760).
//
// No fixtures: like /squat it has no auth gate and must never touch Supabase,
// so nothing is stubbed. Any request to *.supabase.co fails the test rather
// than being quietly fulfilled. Service workers are blocked so every request
// the page makes is the page's own, visible to page.on('request').

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// First paint under parallel load has taken over 10 s for /squat here; the
// placeholder shares its first paint but for its own small chunk.
const PAINT_TIMEOUT = 30_000;

const VERCEL = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')
);

test.use({ serviceWorkers: 'block' });

function recordRequests(page) {
  const urls = [];
  page.on('request', (req) => urls.push(req.url()));
  return urls;
}

const supabaseHits = (urls) =>
  urls.filter((u) => /(^|\.)supabase\.co(:\d+)?$/.test(new URL(u).hostname));

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

async function openRow(page, path = '/row') {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto(path, { timeout: PAINT_TIMEOUT });
  await expect(
    page.getByRole('heading', { level: 1, name: PLACEHOLDER.heading })
  ).toBeVisible({ timeout: PAINT_TIMEOUT });
  return errors;
}

async function axe(page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    .analyze();
  // Readable on failure: rule, then the offending nodes' targets.
  return violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`
  );
}

for (const scheme of ['light', 'dark']) {
  test.describe(`/row — ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test('/row renders the placeholder without contacting Supabase or leaving the origin, follows the theme, and passes axe', async ({
      page,
    }) => {
      const urls = recordRequests(page);
      const errors = await openRow(page);

      await expect(page.getByText(PLACEHOLDER.body)).toBeVisible();
      await expect(
        page.getByRole('link', { name: PLACEHOLDER.squatLink })
      ).toHaveAttribute('href', PLACEHOLDER.squatHref);
      // The tool's own chunk painted it, and the dashboard was never loaded.
      expect(urls.some((u) => toolChunkUrlPattern('RowApp').test(u))).toBe(
        true
      );
      expect(urls.filter((u) => /\/assets\/AuthGate-/.test(u))).toEqual([]);
      expect(supabaseHits(urls)).toEqual([]);
      // Stronger still, and what keeps CI hermetic: nothing leaves the origin.
      const origin = new URL(page.url()).origin;
      expect(
        urls.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin)
      ).toEqual([]);

      // Nothing stored, so the shared preference is Auto: the OS scheme.
      const root = page.getByTestId('row-root');
      await expect(root).toHaveAttribute('data-theme', scheme);
      const ground = rgb((scheme === 'dark' ? DARK : LIGHT).bg);
      expect(
        await root.evaluate((el) => window.getComputedStyle(el).backgroundColor)
      ).toBe(ground);
      expect(
        await page.evaluate(
          () => window.getComputedStyle(document.body).backgroundColor
        )
      ).toBe(ground);
      expect(errors).toEqual([]);

      expect(await axe(page)).toEqual([]);
    });
  });
}

// vite preview has no vercel.json, so /row/'s relative asset URLs would hit
// the SPA fallback. Apply the deployed rewrites — read from vercel.json, not
// restated — first match wins, the catch-all left to the preview server.
test('/row/ loads through the vercel.json rewrites and canonicalises to /row', async ({
  page,
}) => {
  const rules = VERCEL.rewrites
    .filter((r) => r.source !== '/(.*)')
    .map((r) => ({ re: new RegExp(`^${r.source}$`), to: r.destination }));
  await page.route(
    (url) => rules.some((r) => r.re.test(url.pathname)),
    async (route) => {
      const url = new URL(route.request().url());
      const rule = rules.find((r) => r.re.test(url.pathname));
      const m = url.pathname.match(rule.re);
      url.pathname = rule.to.replace(/\$(\d)/g, (_, i) => m[Number(i)]);
      const response = await route.fetch({ url: url.href });
      await route.fulfill({ response });
    }
  );
  const urls = recordRequests(page);
  const errors = await openRow(page, '/row/?from=e2e#top');
  const here = new URL(page.url());
  expect(here.pathname).toBe('/row');
  expect(here.search).toBe('?from=e2e');
  expect(here.hash).toBe('#top');
  expect(urls.some((u) => u.includes('/row/assets/'))).toBe(true);
  expect(supabaseHits(urls)).toEqual([]);
  expect(errors).toEqual([]);
});

test('asks search engines not to index the placeholder', async ({ page }) => {
  const errors = await openRow(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex'
  );
  await expect(page).toHaveTitle(PAGE_TITLE);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    PAGE_DESCRIPTION
  );
  expect(errors).toEqual([]);
});
