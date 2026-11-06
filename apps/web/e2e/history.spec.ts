import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-044: T02 com exclusão e desfazer (US-14) e o conflito entre dois aparelhos com histórico (E06, US-04, RN-97).

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

async function synced(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.syncNow()), { timeout: 20_000 })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__oakE2E?.counts()), { timeout: 20_000 })
    .toMatchObject({ pending: 0, rejected: 0 });
}

async function expense(page: Page, cents: number, description: string): Promise<string> {
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta ${description}`,
  );
  return page.evaluate(([a, c, d]) => window.__oakE2E?.addExpense(a, c, d) ?? '', [
    account,
    cents,
    description,
  ] as [string, number, string]);
}

test('US-14: excluir na T02 tira o lançamento da lista e o Desfazer o traz de volta', async ({
  page,
}) => {
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const description = `Excluir E2E ${Date.now()}`;
  const id = await expense(page, 4590, description);
  await page.goto('/lancamentos');
  await page.getByTestId(`tx-${id}`).click();
  await expect(page).toHaveURL(`/lancamentos/${id}`);
  await expect(page.getByTestId('detail-list')).toContainText(description);
  await page.getByRole('button', { name: 'Excluir' }).click();
  await expect(page).toHaveURL('/lancamentos');
  await expect(page.getByText('Lançamento excluído.')).toBeVisible();
  await expect(page.getByTestId(`tx-${id}`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.getByTestId(`tx-${id}`)).toBeVisible();
});

test('E06: conflict — dois aparelhos editam offline, o mais recente vence e o history mostra as duas versões', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  // aparelho 1 (este contexto) cria e sincroniza
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const id = await expense(page, 4590, `Conflito E2E ${Date.now()}`);
  await synced(page);

  // aparelho 2: outro contexto do mesmo usuário recebe o lançamento
  const other = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const second = await other.newPage();
  await login(second, 'e2e-a@example.test');
  await hooks(second);
  await expect
    .poll(
      async () => {
        await second.evaluate(() => window.__oakE2E?.syncNow());
        return second.evaluate((i) => window.__oakE2E?.amountOf(i), id);
      },
      { timeout: 30_000 },
    )
    .toBe(4590);

  // os dois sem rede: R$ 50,00 no 1 e, depois, R$ 60,00 no 2
  await page.context().setOffline(true);
  await other.setOffline(true);
  await page.evaluate((i) => window.__oakE2E?.setAmount(i, 5000), id);
  await page.waitForTimeout(100);
  await second.evaluate((i) => window.__oakE2E?.setAmount(i, 6000), id);

  // o 2 sincroniza primeiro; o 1 chega depois com a edição mais antiga (stale)
  await other.setOffline(false);
  await synced(second);
  await page.context().setOffline(false);
  await synced(page);
  expect(await page.evaluate((i) => window.__oakE2E?.amountOf(i), id)).toBe(6000);
  expect(await second.evaluate((i) => window.__oakE2E?.amountOf(i), id)).toBe(6000);

  // histórico no aparelho 1: a versão de R$ 50,00 perdida em conflito e a edição para R$ 60,00
  await page.goto(`/lancamentos/${id}`);
  await expect(page.getByTestId('detail-amount')).toContainText('R$ 60,00');
  const items = page.getByTestId('history-item');
  await expect(items.first()).toBeVisible({ timeout: 15_000 });
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  const lost = page.locator('[data-testid="history-item"][data-conflict="true"]');
  await expect(lost).toContainText('Versão perdida em conflito');
  await expect(lost).toContainText('R$ 50,00');
  await expect(page.getByTestId('detail-history')).toContainText(
    'Valor alterado de R$ 45,90 para R$ 60,00',
  );

  // restaurar a versão perdida; o aparelho 2 recebe a mudança com o aviso G06
  await second.goto('/lancamentos');
  await lost.getByRole('button', { name: 'Restaurar esta versão' }).click();
  await expect(page.getByText('Versão restaurada.')).toBeVisible();
  await expect(page.getByTestId('detail-amount')).toContainText('R$ 50,00');
  await synced(page);
  await expect
    .poll(
      async () => {
        await second.evaluate(() => window.__oakE2E?.syncNow());
        return second.evaluate((i) => window.__oakE2E?.amountOf(i), id);
      },
      { timeout: 30_000 },
    )
    .toBe(5000);
  await expect(
    second.getByText('1 lançamento foi atualizado a partir de outro aparelho.'),
  ).toBeVisible();

  // sem rede, o histórico pede conexão
  await page.context().setOffline(true);
  await expect(page.getByTestId('detail-history')).toContainText('Disponível com conexão');
  await page.context().setOffline(false);
  await other.close();
});
