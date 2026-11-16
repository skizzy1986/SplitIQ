import { test, expect } from '@playwright/test';
import { installAppFixtures } from './fixtures.js';
import { DARK } from '../src/constants/themeValues.js';

for (const [name, width] of [
  ['desktop', 1280],
  ['mobile', 390],
]) {
  test(`${name}: the dashboard stays dark and the logger inherits it`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await installAppFixtures(context);
    await page.goto('/');
    await page
      .getByRole('button', {
        name: 'Settings',
        exact: true,
      })
      .click();
    const theme = page.getByRole('group', { name: 'Theme', exact: true });
    await theme.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.getByTestId('theme-root')).toHaveAttribute(
      'data-theme',
      'dark'
    );
    await expect
      .poll(() =>
        page
          .getByTestId('theme-root')
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue('--color-bg').trim()
          )
      )
      .toBe(DARK.bg);
    await page.screenshot({
      path: test.info().outputPath('dark-settings.png'),
    });
    await page.reload();
    await expect(page.getByTestId('theme-root')).toHaveAttribute(
      'data-theme',
      'dark'
    );
    if (width > 767) {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
    } else {
      await page.getByRole('group', { name: 'Theme', exact: true }).waitFor();
    }
    await theme.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.getByTestId('theme-root')).toHaveAttribute(
      'data-theme',
      'dark'
    );
    await theme.getByRole('button', { name: 'Auto', exact: true }).click();
    await expect(page.getByTestId('theme-root')).toHaveAttribute(
      'data-theme',
      'dark'
    );
    if (width > 767) {
      await page.getByRole('button', { name: 'Train', exact: true }).click();
      await page.getByRole('tab', { name: 'Logger', exact: true }).click();
    } else {
      await page
        .getByRole('button', { name: 'Back to Today', exact: true })
        .click();
      await page.getByRole('button', { name: 'Train', exact: true }).click();
      await page.getByRole('button', { name: /Strength session/ }).click();
    }
    const logger = page.locator('.slog');
    await expect(logger).not.toHaveAttribute('data-theme', 'light');
    await expect
      .poll(() =>
        logger.evaluate((el) =>
          getComputedStyle(el).getPropertyValue('--color-bg').trim()
        )
      )
      .toBe(DARK.bg);
    await expect(logger).toHaveCSS('color-scheme', 'dark');
    await page.goto('/squat');
    await expect(page.getByTestId('theme-root')).toHaveAttribute(
      'data-theme',
      'light'
    );
  });
}

test('signed-out login honors the shared anatomy preference', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('splitiq.theme', 'dark'));
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'SIGN IN', exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('theme-root')).toHaveAttribute(
    'data-theme',
    'dark'
  );
  await page.goto('/squat');
  await expect(
    page.getByRole('heading', { name: 'High-bar back squat', exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('theme-root')).toHaveAttribute(
    'data-theme',
    'dark'
  );
});
