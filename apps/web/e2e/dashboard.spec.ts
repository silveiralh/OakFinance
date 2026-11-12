import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-058/T-120: Início pelo gasto do mês (D-081; E02, US-30, RN-46, RN-51). Os casos exatos (referência, sem renda,
// faixas e virada do mês) rodam em `test/dashboard.test.tsx` com data fixa: fixar o relógio no navegador quebra a
// sessão do Supabase (ver HANDOFF).

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

async function attr(
  page: Page,
  name: 'data-spent' | 'data-balance',
  testId: string,
): Promise<number> {
  return Number(await page.getByTestId(testId).getAttribute(name));
}

test('E02: dashboard — uma despesa lançada sem rede soma no "Gasto em {mês}" e sai do saldo nas contas no valor exato', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta painel ${stamp}`,
  );
  await page.evaluate(([a, d]) => window.__oakE2E?.addIncome(a, 500000, d), [
    account,
    `Renda painel ${stamp}`,
  ] as [string, string]);
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.syncNow()), { timeout: 20_000 })
    .toBe(true);

  await page.goto('/');
  await hooks(page);
  const hero = page.getByTestId('home-hero');
  await expect(hero).toHaveAttribute('data-spent', /^-?\d+$/);
  await expect(page.getByText(/^Gasto em /)).toBeVisible();
  await expect(page.getByTestId('home-upcoming-month')).toContainText('Ainda vai sair este mês');
  await expect(page.getByText(/Disponível para gastar/)).toHaveCount(0);

  // sem rede, nada chega de outros aparelhos: a diferença vem só deste lançamento (RN-51)
  await page.context().setOffline(true);
  await expect(page.getByTestId('g01')).toBeVisible();
  const spent = await attr(page, 'data-spent', 'home-hero');
  const balance = await attr(page, 'data-balance', 'home-balance');
  await page.evaluate(([a, d]) => window.__oakE2E?.addExpense(a, 4590, d), [
    account,
    `Painel ${stamp}`,
  ] as [string, string]);
  await expect.poll(() => attr(page, 'data-spent', 'home-hero')).toBe(spent + 4590);
  await expect.poll(() => attr(page, 'data-balance', 'home-balance')).toBe(balance - 4590);

  await page.context().setOffline(false);
});

/** "R$ 1.234,56" → 123456. */
function spentCents(text: string): number {
  const m = /R\$\s?([\d.]+),(\d{2})/.exec(text);
  return m ? Number(m[1]?.replace(/\./g, '')) * 100 + Number(m[2]) : Number.NaN;
}

test('E17: sem renda, a Saúde do mês pede a renda e o gasto do mês sobe no valor exato', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  // usuário que nunca recebe renda (seed.sql): o estado "sem renda" vale também nas repetições do nightly
  await login(page, `e2e-dash-${info.project.name}@example.test`);
  await hooks(page);
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta sem renda ${Date.now()}`,
  );
  await page.goto('/');
  await hooks(page);
  await expect(page.getByTestId('home-health-no-income')).toContainText(
    'Cadastre sua renda para acompanhar as faixas do mês.',
  );
  const money = page.getByTestId('home-hero-money');
  await expect(money).toHaveText(/^R\$\s[\d.]+,\d{2}$/);
  const before = spentCents((await money.textContent()) ?? '');
  await page.evaluate((a) => window.__oakE2E?.addExpense(a, 4590, 'Sem renda'), account);
  await expect.poll(async () => spentCents((await money.textContent()) ?? '')).toBe(before + 4590);
});
