import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-069: US-35 no projeto `desktop` (≥ 1024 px): os 5 blocos da análise na P01, "Ver como tabela" e a troca de mês.
// No celular a análise não aparece (só a P01 normal). Os números exatos estão em test/analysis.test.tsx.

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

test('US-35: análise do mês no computador com tabela equivalente e seletor de mês', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await login(page);
  await hooks(page);
  const stamp = Date.now();
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta análise ${stamp}`,
  );
  await page.evaluate((id) => window.__oakE2E?.addExpense(id, 4321, 'Gasto da análise'), account);

  await page.goto('/planejar/orcamento');
  await expect(page.getByTestId('screen-P01')).toBeVisible();
  if (info.project.name !== 'desktop') {
    await expect(page.getByTestId('month-analysis')).toHaveCount(0);
    return;
  }
  const analysis = page.getByTestId('month-analysis');
  await expect(analysis).toBeVisible();
  for (const id of ['categories', 'bands', 'daily', 'compare', 'top']) {
    await expect(page.getByTestId(`analysis-${id}`)).toBeVisible();
  }
  const top = page.getByTestId('analysis-top');
  await top.getByRole('button', { name: 'Ver como tabela' }).click();
  await expect(top.getByRole('table', { name: '10 maiores gastos' })).toBeVisible();
  await expect(top.getByRole('table')).toContainText('Gasto da análise');

  const select = page.getByLabel('Mês da análise');
  const previous = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(previous ?? '');
  await expect(page.getByTestId('analysis-current')).not.toHaveText(
    (await select.locator('option').first().textContent()) ?? '',
  );
  await expect(top).not.toContainText('Gasto da análise');
});
