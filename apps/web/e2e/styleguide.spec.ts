import { expect, test } from './fixtures/base';

// T-028: snapshot visual inicial dos tokens. Atualizar esta referência exige `needs-owner`.
test('US-62: styleguide renderiza os tokens e os componentes de dados', async ({ page }) => {
  await page.goto('/__styleguide');
  await page.evaluate(() => document.fonts.ready);
  const tokens = page.getByTestId('tokens');
  await expect(tokens).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'No ritmo do mês' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  await expect(tokens).toHaveScreenshot('tokens.png', {
    maxDiffPixelRatio: 0.01,
    animations: 'disabled',
  });
});
