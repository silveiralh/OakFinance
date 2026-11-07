import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-065: E01 completo (US-08) — login → seeds → ON04 a ON08 → Início com "Disponível para gastar"; o passo pulado
// vira o card "Complete a configuração"; "Refazer configuração inicial" e a retomada no passo em que parou.
// Cada projeto usa um usuário novo (seed.sql), porque o progresso fica na conta.

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

const stepper = (page: Page) => page.getByTestId('onb-stepper');
const next = (page: Page) => page.getByTestId('onb-continue').click();

test('E01: onboarding completo, Pular, retomar e refazer sem duplicar', async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page, `e2e-onb-${info.project.name}@example.test`);
  await hooks(page);
  const seeded = { categories: 31, reminders: 9, budgets: 3, goals: 1, rejected: 0 };
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.counts()), { timeout: 20_000 })
    .toMatchObject(seeded);

  await page.goto('/boas-vindas/lembretes');
  await expect(stepper(page)).toHaveText('Passo 1 de 5 · Lembretes');
  await page.getByTestId('onb-skip').click(); // "Agora não"

  await expect(stepper(page)).toHaveText('Passo 2 de 5 · Renda');
  await page.getByTestId('onb-income-amount').getByRole('textbox').fill('500000');
  await next(page);

  await expect(stepper(page)).toHaveText('Passo 3 de 5 · Contas');
  await page.locator('label', { hasText: 'Banco do Brasil' }).click();
  await page.locator('label', { hasText: 'Carteira (dinheiro)' }).click();
  await expect(page.getByTestId('onb-line-bb')).toBeVisible();
  await next(page);

  await expect(stepper(page)).toHaveText('Passo 4 de 5 · Cartões');
  await page.getByLabel('Nome do cartão').fill('Nubank');
  await page.getByLabel('Dia de fechamento').fill('3');
  await page.getByLabel('Dia de vencimento').fill('10');
  await expect(page.getByTestId('onb-card-0-preview')).toContainText(
    'Compras de hoje vão para a fatura de',
  );
  await next(page);

  await expect(stepper(page)).toHaveText('Passo 5 de 5 · Reserva');
  await page.getByTestId('onb-reserve-saved').getByRole('textbox').fill('200000');
  await next(page);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuração concluída');
  await page.getByTestId('onb-done-home').click();
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero')).toContainText('Disponível para gastar');
  await expect(page.getByTestId('onb-pending')).toContainText('Complete a configuração: lembretes');
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.accountNames()))
    .toEqual(expect.arrayContaining(['Banco do Brasil', 'Carteira']));

  // Refazer: reabre o ON04 sem apagar dados; pular até a renda e "fechar o app" no passo 2
  await page.goto('/ajustes');
  await page.getByRole('button', { name: 'Refazer configuração inicial' }).click();
  await expect(stepper(page)).toHaveText('Passo 1 de 5 · Lembretes');
  await page.getByTestId('onb-skip').click();
  await expect(stepper(page)).toHaveText('Passo 2 de 5 · Renda');
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.syncNow()), { timeout: 20_000 })
    .toBe(true);

  await page.goto('/');
  await expect(page).toHaveURL('/boas-vindas/renda');
  await expect(stepper(page)).toHaveText('Passo 2 de 5 · Renda');
  await hooks(page);
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.counts()), { timeout: 20_000 })
    .toMatchObject({ ...seeded, pending: 0 });
  expect(await page.evaluate(() => window.__oakE2E?.accountNames())).toHaveLength(2);
});
