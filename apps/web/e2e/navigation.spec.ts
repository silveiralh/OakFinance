import { expect, login, test } from './fixtures/base';

// T-118 (D-076): no celular, toda tela se alcança a partir das abas, sem digitar URL. O menu da conta (avatar no
// topo das abas principais) leva a Configurações, Importar extrato e Ler nota fiscal; as subtelas têm Voltar; o
// Planejar tem as abas internas Orçamento · Reserva · Futuro · Fechar o mês.

test('US-58: menu da conta, Voltar das subtelas e abas internas do Planejar', async ({ page }) => {
  await login(page);
  await page.goto('/');
  await expect(page.getByTestId('screen-H01')).toBeVisible();
  const back = page.getByRole('banner').getByRole('button', { name: 'Voltar', exact: true });

  // Configurações pelo avatar, e uma subtela com Voltar
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  const menu = page.getByTestId('account-menu');
  await expect(menu.getByRole('button', { name: 'Sair' })).toBeVisible();
  await menu.getByRole('button', { name: 'Configurações', exact: true }).click();
  await expect(page).toHaveURL('/ajustes');
  await page.getByRole('button', { name: 'Contas e cartões', exact: true }).click();
  await expect(page).toHaveURL('/ajustes/contas');
  await back.click();
  await expect(page).toHaveURL('/ajustes');
  await back.click();
  await expect(page).toHaveURL('/');

  // Importar extrato e Ler nota fiscal pelo menu da conta
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  await page
    .getByTestId('account-menu')
    .getByRole('button', { name: 'Importar extrato', exact: true })
    .click();
  await expect(page).toHaveURL('/importar');
  await back.click();
  await expect(page).toHaveURL('/');

  // Planejar: as quatro abas internas
  await page
    .getByRole('navigation', { name: 'Navegação principal' })
    .getByRole('link', { name: 'Planejar' })
    .click();
  await expect(page).toHaveURL('/planejar/orcamento');
  const tabs = page.getByTestId('plan-tabs');
  await tabs.getByText('Reserva', { exact: true }).click();
  await expect(page).toHaveURL('/planejar/reserva');
  await page.getByTestId('plan-tabs').getByText('Futuro', { exact: true }).click();
  await expect(page).toHaveURL('/planejar/futuro');
  await page.getByTestId('plan-tabs').getByText('Fechar o mês', { exact: true }).click();
  await expect(page).toHaveURL(/\/planejar\/fechar\/\d{4}-\d{2}$/);
  await expect(page.getByRole('button', { name: 'Abrir menu da conta' })).toBeVisible();
});
