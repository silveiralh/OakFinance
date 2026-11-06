import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-035: seeds no primeiro login (parte de seeds do E01) e isolamento entre usuários (E11).

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

const counts = (page: Page) => page.evaluate(() => window.__oakE2E?.counts());

test('E01: o primeiro login cria os seeds, sincroniza sem rejeição e relogar não duplica', async ({
  page,
}) => {
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const seeded = { categories: 31, reminders: 9, budgets: 3, goals: 1, pending: 0, rejected: 0 };
  await expect.poll(() => counts(page), { timeout: 20_000 }).toMatchObject(seeded);
  const first = await counts(page);

  await page.goto('/ajustes');
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL('/entrar');

  await login(page, 'e2e-a@example.test');
  await hooks(page);
  await expect
    .poll(() => counts(page), { timeout: 20_000 })
    .toMatchObject({
      ...seeded,
      category_rules: first?.category_rules,
    });
});

test('E11: o usuário B não vê nada do A, nem pela tela nem por URL direta', async ({
  page,
  browser,
}) => {
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const name = `Conta do A ${Date.now()}`;
  const id = await page.evaluate((n) => window.__oakE2E?.addAccount(n), name);
  await expect.poll(() => page.evaluate(() => window.__oakE2E?.syncNow())).toBe(true);
  await expect.poll(() => counts(page)).toMatchObject({ pending: 0, rejected: 0 });

  const other = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const b = await other.newPage();
  await login(b, 'e2e-b@example.test');
  await hooks(b);
  await expect
    .poll(() => counts(b), { timeout: 20_000 })
    .toMatchObject({ categories: 31, pending: 0 });
  expect(await b.evaluate(() => window.__oakE2E?.accountNames())).not.toContain(name);
  await b.goto(`/lancamentos/${id}`);
  await expect(b.getByRole('heading', { level: 1 })).toHaveText('Detalhe do lançamento');
  await expect(b.getByText(name)).toHaveCount(0);
  await other.close();
});
