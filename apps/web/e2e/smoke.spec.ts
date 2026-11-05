import { expect, test } from './fixtures/base';

test('US-03: a casca do app abre com a marca tipográfica', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'OakFinance' })).toBeVisible();
  await expect(page).toHaveTitle('OakFinance');
});

test('as datas do navegador seguem o fuso America/Sao_Paulo', async ({ page }) => {
  await page.goto('/');
  const timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(timeZone).toBe('America/Sao_Paulo');
});
