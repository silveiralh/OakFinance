import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-045: offline ponta a ponta (E03, US-04, US-64, RN-95, RN-96, RN-100).

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

test('E03: offline — lança 3, edita 1 e exclui 1, recarrega, a rede volta e o servidor recebe tudo', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();
  const account = await page.evaluate(
    (n) => window.__oakE2E?.addAccount(n) ?? '',
    `Conta offline ${stamp}`,
  );
  await synced(page);
  // a T01 carrega online; depois a navegação é toda local
  await page.goto('/lancamentos');
  await expect(page.getByTestId('screen-T01')).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByTestId('g01')).toHaveText(
    'Sem conexão. Você pode continuar lançando; tudo fica salvo no aparelho.',
  );
  await expect(page.getByTestId('sync-badge').getByRole('button')).toHaveAccessibleName(/^Offline/);

  const ids: string[] = [];
  for (const [i, cents] of [1000, 2000, 3000].entries()) {
    ids.push(
      await page.evaluate(([a, c, d]) => window.__oakE2E?.addExpense(a, c, d) ?? '', [
        account,
        cents,
        `Offline ${stamp} ${i + 1}`,
      ] as [string, number, string]),
    );
  }
  const [first = '', edited = '', removed = ''] = ids;
  await page.evaluate((id) => window.__oakE2E?.setAmount(id, 2500), edited);
  await page.evaluate((id) => window.__oakE2E?.remove(id), removed);

  // aparece na lista na hora com o selo "Não sincronizado"
  await expect(page.getByTestId(`tx-${first}`)).toContainText('Não sincronizado');
  await expect(page.getByTestId(`tx-${edited}`)).toContainText('Não sincronizado');
  await expect(page.getByTestId(`tx-${removed}`)).toHaveCount(0);
  await expect(page.getByTestId('sync-badge').getByRole('button')).toHaveAccessibleName(
    /^Offline, \d+ lançamentos salvos neste aparelho$/,
  );

  // android e desktop: o shell vem do Service Worker e os dados continuam (o WebKit do Playwright não usa SW)
  if (testInfo.project.name !== 'iphone') {
    await page.reload();
    await expect(page.getByTestId(`tx-${first}`)).toContainText('Não sincronizado');
    await expect(page.getByTestId(`tx-${edited}`)).toBeVisible();
    await expect(page.getByTestId(`tx-${removed}`)).toHaveCount(0);
    await hooks(page);
  }

  // rede volta: a fila zera e o selo some
  await page.context().setOffline(false);
  await synced(page);
  await expect(page.getByTestId(`tx-${first}`)).not.toContainText('Não sincronizado');

  // outro contexto do mesmo usuário baixa do servidor exatamente o que foi feito offline
  const other = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const second = await other.newPage();
  await login(second, 'e2e-a@example.test');
  await hooks(second);
  await expect
    .poll(
      async () => {
        await second.evaluate(() => window.__oakE2E?.syncNow());
        return second.evaluate(
          (list) => Promise.all(list.map((id) => window.__oakE2E?.rowState(id) ?? null)),
          ids,
        );
      },
      { timeout: 30_000 },
    )
    .toEqual([
      { amount: 1000, deleted: false },
      { amount: 2500, deleted: false },
      { amount: 3000, deleted: true },
    ]);
  await other.close();
});
