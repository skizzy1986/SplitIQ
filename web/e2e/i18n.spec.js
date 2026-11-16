import { test, expect } from '@playwright/test';
import { seedSession, stubSupabase } from './fixtures.js';

// The language control on the signed-out login card: reachable before there
// is an account, remembered across a reload, and owning <html lang>.
test.describe('language on the login screen', () => {
  test.beforeEach(async ({ context }) => {
    await stubSupabase(context);
  });

  test('switches to Spanish, keeps it across a reload, and tags the page', async ({
    page,
  }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Español' });
    await expect(toggle).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await toggle.click();
    await expect(page.getByText('Inicia sesión para continuar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-CO');

    const back = page.getByRole('button', { name: 'English' });
    const box = await back.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await page.reload();
    await expect(page.getByText('Inicia sesión para continuar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-CO');
  });

  test('stays in English and says so when the Spanish catalog cannot load', async ({
    page,
    context,
  }) => {
    await context.route(/\/assets\/i18n-[^/]+\.js$/, (route) => route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Español' }).click();
    await expect(page.getByText(/Spanish could not be loaded/)).toBeVisible();
    await expect(
      page.getByText(/No se pudo cargar el español/)
    ).toHaveAttribute('lang', 'es-CO');
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('fits a 360px phone in Spanish without sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Español' }).click();
    await expect(page.getByText('Inicia sesión para continuar')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// A first visit follows the device's top-ranked language (SPEC amendment
// 2026-11-14), and detection never stores a choice.
test.describe('first visit on a Spanish device', () => {
  test.use({ locale: 'es-CO' });

  test.beforeEach(async ({ context }) => {
    await stubSupabase(context);
  });

  test('opens the login card in Spanish with zero taps', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Inicia sesión para continuar')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-CO');
    await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
    expect(
      await page.evaluate(() => window.localStorage.getItem('splitiq.lang'))
    ).toBeNull();
  });

  test('an explicit English choice wins over the device on reload', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('first visit when Spanish is not the top-ranked language', () => {
  test.use({ locale: 'fr-FR' });

  test.beforeEach(async ({ context }) => {
    await stubSupabase(context);
  });

  test('opens in English', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Sign in to continue')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

// A1-A4 on a phone: the language control is two labelled taps from every
// destination (Settings in the top bar, then the language), named in its own
// words, and a switch holds across a reload.
test.describe('language from the mobile shell', () => {
  for (const width of [360, 430]) {
    test(`two labelled taps from every destination at ${width}px`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await stubSupabase(context);
      await seedSession(context);
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('.siq-splash')).toHaveCount(0, {
        timeout: 10_000,
      });

      for (const tab of ['Today', 'Train', 'Progress', 'Body']) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        const settings = page.getByRole('button', {
          name: 'Settings',
          exact: true,
        });
        await expect(settings).toHaveText('Settings');
        const box = await settings.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        await settings.click();
        await expect(
          page.getByRole('group', { name: 'Language' })
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'English' })
        ).toBeVisible();
        await page.getByRole('button', { name: `Back to ${tab}` }).click();
        await expect(settings).toBeFocused();
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Español' }).click();
      await expect(page.getByRole('group', { name: 'Idioma' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'es-CO');
      await page.reload();
      await expect(page.getByRole('group', { name: 'Idioma' })).toBeVisible({
        timeout: 15_000,
      });
    });
  }
});
