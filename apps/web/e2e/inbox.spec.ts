import type { Page } from '@playwright/test';
import { expect, freshUser, login, test } from './fixtures/base';

// T-079: I05 Conferir importados (US-49). A conexão bancária (T-076) ainda não existe na tela, então os
// lançamentos "recebidos do banco" entram pelo gancho do E2E e sobem pelo sync como os da Pluggy subiriam.
// Um usuário por projeto e tentativa (`freshUser`), para os navegadores e as repetições não dividirem a fila.

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

test('US-49: decidir "É o mesmo", dar OK num novo do banco e esvaziar a fila', async ({
  page,
}, info) => {
  await login(page, freshUser('inbox', info));
  await hooks(page);
  const tag = `${info.project.name}-${Date.now()}`;
  const account = await page.evaluate((n) => window.__oakE2E?.addAccount(n) ?? '', `Conta ${tag}`);
  const args = (cents: number, description: string) =>
    [account, cents, description] as [string, number, string];
  await page.evaluate(
    ([a, c, d]) => window.__oakE2E?.addExpense(a, c, d),
    args(5000, `Padaria ${tag}`),
  );
  await page.evaluate(
    ([a, c, d]) => window.__oakE2E?.addImported(a, c, d, 'suggested'),
    args(5150, `PADARIA BANCO ${tag}`),
  );
  await page.evaluate(
    ([a, c, d]) => window.__oakE2E?.addImported(a, c, d, 'new'),
    args(999, `NOVO BANCO ${tag}`),
  );

  await page.goto('/conferir');
  await expect(page.getByTestId('screen-I05')).toBeVisible();
  await expect(page.getByTestId('inbox-count')).toHaveText('2 para conferir');
  const card = page.getByTestId('reconcile-card');
  await expect(card.getByText('Lançado por você')).toBeVisible();
  await expect(card.getByText('Valor diferente: R$ 50,00 × R$ 51,50')).toBeVisible();
  await card.getByRole('button', { name: 'É o mesmo' }).click();
  await expect(page.getByTestId('reconcile-card')).toHaveCount(0);
  await expect(page.getByTestId('inbox-count')).toHaveText('1 para conferir');

  const fresh = page.getByTestId('inbox-fresh-item').filter({ hasText: `NOVO BANCO ${tag}` });
  await fresh.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByTestId('inbox-fresh')).toHaveCount(0);

  // o vinculado aparece no grupo dos últimos 7 dias
  await page.getByText('Vinculados automaticamente').click();
  await expect(page.getByTestId('inbox-auto').getByText(`Padaria ${tag}`)).toBeVisible();
});
