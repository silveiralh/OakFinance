import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures/base';

// T-047: C01/C02 e mover item de fatura (US-17, US-18, RN-12..RN-15, RN-18). O cenário de 15/11/2026 roda com o
// relógio fixo nos testes de componente (`test/invoices.test.tsx`); aqui o relógio é o real.

async function hooks(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__oakE2E))).toBe(true);
}

/**
 * Seleciona o cartão no carrossel da C01. T-123 (UXB-025): tocar no cartão já selecionado abre a fatura, então só
 * toca quando ele ainda não é o selecionado.
 */
async function selectCard(page: Page, name: string) {
  const slide = page.locator('[aria-roledescription="cartão"]', { hasText: name });
  await expect(slide).toBeVisible();
  if ((await slide.getAttribute('data-selected')) !== 'true') {
    await slide.getByRole('button').click();
  }
  await expect(slide).toHaveAttribute('data-selected', 'true');
}

test('US-18: invoices — a C01 mostra a fatura atual, a C02 lista a compra e o item muda de fatura', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();
  const name = `Cartão E2E ${stamp % 100_000}`;
  const card = await page.evaluate(([n]) => window.__oakE2E?.addCard(n, 3, 10) ?? '', [name] as [
    string,
  ]);
  const description = `Compra fatura ${stamp}`;
  const id = await page.evaluate(([c, d]) => window.__oakE2E?.addCardExpense(c, 4590, d) ?? '', [
    card,
    description,
  ] as [string, string]);

  await page.goto('/cartoes');
  await selectCard(page, name);
  await expect(page.getByTestId('cards-state')).toHaveText(
    /^(Fecha em \d{2}\/\d{2} \(\d+ dias\)|Fecha hoje)$/,
  );
  await expect(page.getByTestId('cards-upcoming').getByRole('button')).toHaveCount(3);

  await page.getByRole('button', { name: 'Ver fatura' }).click();
  await expect(page).toHaveURL(new RegExp(`/cartoes/${card}/fatura/\\d{4}-\\d{2}$`));
  // T-123 (UXB-021): aberta numa linha só
  await expect(page.getByTestId('invoice-head')).toContainText(
    /(Fecha em \d{2}\/\d{2} \(\d+ dias\)|Fecha hoje) · Vence em 10\/\d{2}/,
  );
  await expect(page.getByTestId(`tx-${id}`)).toBeVisible();
  await expect(page.getByTestId('invoice-total')).toHaveText('R$ 45,90');

  // T02: mover para a fatura seguinte (fica fixada, RN-18)
  await page.getByTestId(`tx-${id}`).getByRole('button').first().click();
  await expect(page).toHaveURL(`/lancamentos/${id}`);
  await page.getByRole('button', { name: 'Mover para outra fatura' }).click();
  const options = page
    .getByTestId('move-dialog')
    .getByRole('button', { name: /^Mover para a fatura de / });
  const target = (await options.first().textContent()) ?? '';
  await options.first().click();
  // o toast pode esperar na fila atrás de avisos de outros testes do mesmo usuário (G06); confere o dado
  const month = target.replace('Mover para a fatura de ', '');
  await expect(page.getByTestId('detail-list')).toContainText(month, { timeout: 15_000 });

  // a fatura de origem fica vazia
  await page.goBack();
  await expect(page.getByText('Nenhuma compra nesta fatura', { exact: true })).toBeVisible();
});

test('E04: invoices — compra à vista no cartão e "Registrar pagamento" deixam a fatura paga', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();
  const accountName = `Conta pagamento ${stamp}`;
  await page.evaluate((n) => window.__oakE2E?.addAccount(n), accountName);
  const name = `Cartão pago ${stamp % 100_000}`;
  const card = await page.evaluate(([n]) => window.__oakE2E?.addCard(n, 3, 10) ?? '', [name] as [
    string,
  ]);
  const id = await page.evaluate(([c, d]) => window.__oakE2E?.addCardExpense(c, 12_000, d) ?? '', [
    card,
    `Compra paga ${stamp}`,
  ] as [string, string]);

  await page.goto('/cartoes');
  await selectCard(page, name);
  await page.getByRole('button', { name: 'Ver fatura' }).click();
  // a fatura aberta é a do cartão criado aqui (o e2e-a acumula cartões de outros testes)
  await expect(page).toHaveURL(new RegExp(`/cartoes/${card}/fatura/\\d{4}-\\d{2}$`));
  await expect(page.getByTestId(`tx-${id}`)).toBeVisible();
  await page.getByRole('button', { name: 'Registrar pagamento' }).click();
  const sheet = page.getByTestId('pay-sheet');
  await expect(sheet.getByLabel('Valor do pagamento')).toHaveValue('R$\u00A0120,00');
  await sheet.getByLabel('Conta de origem').selectOption({ label: accountName });
  await sheet.getByRole('button', { name: 'Registrar pagamento' }).click();
  await expect(page.getByText(/^Pagamento da fatura de .+ registrado\.$/)).toBeVisible();
  await expect(page.getByTestId('invoice-head')).toContainText('Paga');
  await expect(page.getByRole('button', { name: 'Registrar pagamento' })).toHaveCount(0);
});

test('E04: installments — compra em 3x no cartão "fecha 3 / vence 10" aparece nas 3 faturas certas', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await login(page, 'e2e-a@example.test');
  await hooks(page);
  const stamp = Date.now();
  const name = `Cartão 3x ${stamp % 100_000}`;
  const card = await page.evaluate(([n]) => window.__oakE2E?.addCard(n, 3, 10) ?? '', [name] as [
    string,
  ]);
  const description = `Parcelada ${stamp}`;
  await page.evaluate(([c, d]) => window.__oakE2E?.addCardInstallments(c, 30_000, 3, d) ?? '', [
    card,
    description,
  ] as [string, string]);

  await page.goto('/cartoes');
  await selectCard(page, name);
  await page.getByRole('button', { name: 'Ver fatura' }).click();
  for (const k of [1, 2, 3]) {
    const items = page.getByTestId('invoice-items');
    await expect(items).toContainText(description);
    await expect(items).toContainText(`${k}/3`);
    await expect(page.getByTestId('invoice-total')).toHaveText('R$ 100,00');
    await page.getByRole('button', { name: 'Próximo mês' }).click();
  }
  // a 4ª fatura não tem parcela
  await expect(page.getByText('Nenhuma compra nesta fatura', { exact: true })).toBeVisible();
});
