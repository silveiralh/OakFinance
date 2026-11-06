import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-059: P01 Orçamento 50/30/20 (US-31, US-32, RN-41). Os números exatos (metas, "já foi"/"vai sair", limite e
// aviso de 80%) rodam em `test/budget.test.tsx`; aqui, a tela com dados reais do Supabase local e sem rede.

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

function count(text: string | null): number {
  const n = /(\d+) lançamentos? para classificar/.exec(text ?? '');
  return n ? Number(n[1]) : 0;
}

test('budget — P01 mostra as três faixas e um gasto sem categoria entra em "Sem faixa" na hora, sem rede', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta orçamento ${stamp}`,
  );
  await page.evaluate(([a, d]) => window.__oakE2E?.addIncome(a, 300000, d), [
    account,
    `Renda orçamento ${stamp}`,
  ] as [string, string]);
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.syncNow()), { timeout: 20_000 })
    .toBe(true);

  await page.goto('/planejar/orcamento');
  await hooks(page);
  await expect(page.getByTestId('screen-P01')).toBeVisible();
  for (const band of ['Necessidades', 'Desejos', 'Poupança']) {
    await expect(page.getByRole('button', { name: new RegExp(band) })).toBeVisible();
  }
  await expect(page.getByTestId('budget-savings')).toContainText('Poupado');
  await expect(page.getByText(/^Renda do mês/)).toBeVisible();

  await page.context().setOffline(true);
  const group = page.getByTestId('budget-unbucketed');
  const before = (await group.count()) > 0 ? count(await group.textContent()) : 0;
  await page.evaluate(([a, d]) => window.__oakE2E?.addExpense(a, 1990, d), [
    account,
    `Sem faixa ${stamp}`,
  ] as [string, string]);
  await expect.poll(async () => count(await group.textContent())).toBe(before + 1);
  await expect(group.getByRole('link', { name: 'Classificar' })).toBeVisible();

  await page.context().setOffline(false);
});
