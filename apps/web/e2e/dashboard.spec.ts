import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-058: painel "Disponível para gastar" (E02, US-30, RN-47, RN-51). Os casos exatos da E17 (referência, sem renda,
// negativo, zero e virada do mês) rodam em `test/dashboard.test.tsx` com data fixa: fixar o relógio no navegador
// quebra a sessão do Supabase (ver HANDOFF).

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

async function available(page: Page): Promise<number> {
  const value = await page.getByTestId('home-hero').getAttribute('data-available');
  return Number(value);
}

test('E02: dashboard — uma despesa lançada sem rede diminui o "Disponível para gastar" no valor exato', async ({
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
  // garante Base > 0 no mês (o painel mostra o valor só com renda, RN-48)
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
  await expect(hero).toHaveAttribute('data-available', /^-?\d+$/);
  await expect(page.getByText(/^Disponível para gastar em /)).toBeVisible();

  // sem rede, nada chega de outros aparelhos: a diferença vem só deste lançamento (RN-51)
  await page.context().setOffline(true);
  await expect(page.getByTestId('g01')).toBeVisible();
  const before = await available(page);
  await page.evaluate(([a, d]) => window.__oakE2E?.addExpense(a, 4590, d), [
    account,
    `Painel ${stamp}`,
  ] as [string, string]);
  await expect.poll(() => available(page)).toBe(before - 4590);

  // H01-S: o total da fórmula é o mesmo valor do herói
  await page.getByTestId('home-how').click();
  const sheet = page.getByRole('dialog', { name: 'Como o valor é calculado' });
  await expect(sheet).toBeVisible();
  const shown = ((await page.getByTestId('home-hero-money').textContent()) ?? '').trim();
  await expect(sheet.getByTestId('home-formula-total')).toContainText(shown);
  await expect(sheet.getByText('Gastos realizados')).toBeVisible();

  await page.context().setOffline(false);
});

/** "Você já gastou R$ 1.234,56 este mês" → 123456. */
function spentCents(text: string): number {
  const m = /R\$\s?([\d.]+),(\d{2})/.exec(text);
  return m ? Number(m[1]?.replace(/\./g, '')) * 100 + Number(m[2]) : Number.NaN;
}

test('E17: sem renda, o painel pede a renda e mostra quanto já foi gasto, que sobe no valor exato', async ({
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
  const hero = page.getByTestId('home-hero');
  await expect(hero.getByText('Cadastre sua renda para ver quanto pode gastar')).toBeVisible();
  await expect(hero).not.toHaveAttribute('data-available', /.+/);
  const money = page.getByTestId('home-hero-money');
  await expect(money).toHaveText(/^Você já gastou R\$ [\d.]+,\d{2} este mês$/);
  const before = spentCents((await money.textContent()) ?? '');
  await page.evaluate((a) => window.__oakE2E?.addExpense(a, 4590, 'Sem renda'), account);
  await expect.poll(async () => spentCents((await money.textContent()) ?? '')).toBe(before + 4590);
});
