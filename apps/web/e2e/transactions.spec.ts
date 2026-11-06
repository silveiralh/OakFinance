import { expect, login, test } from './fixtures/base';

// T-043: T01 com o mês, o resumo, os chips e a busca (US-15, US-63).

test('US-15: a lista abre no mês atual, filtra por chip e a busca sem resultado mostra o vazio', async ({
  page,
}) => {
  await login(page, 'e2e-a@example.test');
  await page.goto('/lancamentos');
  await expect(page.getByTestId('screen-T01')).toBeVisible();
  await expect(page.getByTestId('list-summary')).toContainText('Entradas');
  const expenses = page.getByRole('button', { name: 'Despesas', exact: true });
  await expenses.click();
  await expect(expenses).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('list-total')).toContainText('Total filtrado:');
  await page.getByLabel('Buscar lançamentos').fill('zzzz sem resultado');
  await expect(page.getByText('Nenhum resultado para "zzzz sem resultado"')).toBeVisible();
  const month = await page.getByTestId('list-month').textContent();
  await page.getByRole('button', { name: 'Mês anterior' }).click();
  await expect(page.getByTestId('list-month')).not.toHaveText(month ?? '');
});
