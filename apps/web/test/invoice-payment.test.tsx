import { CARRY_OVER_DESCRIPTION, type Card, type Tx } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { cardFromRow, txFromRow } from '../src/data/mappers';
import { invoiceStateLine } from '../src/features/cards/CardsScreen';
import { InvoiceScreen } from '../src/features/cards/InvoiceScreen';
import {
  buildPayment,
  defaultPaymentTarget,
  invoiceView,
  payableInvoices,
  planCardData,
} from '../src/features/cards/model';
import { buildInvoice } from '../src/features/quick-entry/model';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const USER = '00000000-0000-7000-8000-000000000001';
/** Dia em que nov/2026 (F=3, V=10) já fechou e ainda não venceu. */
const TODAY = '2026-11-05';

function cardRow(): LocalRow<'cards'> {
  return makeRow('cards', {
    id: 'a',
    name: 'Cartão A',
    closing_day: 3,
    due_day: 10,
    closing_day_rule: 'next',
    limit_cents: null,
    payment_account_id: 'bb',
    deleted_at: null,
    archived_at: null,
    color: null,
    last4: null,
    sort_order: 0,
  });
}
const CARD: Card = cardFromRow(cardRow());
const NOV = invoiceView(CARD, '2026-11', [], [], TODAY).period;

function purchase(id: string, cents: number): LocalRow<'transactions'> {
  return tx(id, {
    kind: 'expense',
    status: 'posted',
    amount_cents: cents,
    card_id: CARD.id,
    account_id: null,
    invoice_id: NOV.id,
    payment_method: 'credit',
    occurred_on: NOV.periodStart,
    review_state: 'ok',
    deleted_at: null,
  });
}

function payment(cents: number): LocalRow<'transactions'> {
  return buildPayment({
    id: `pay-${cents}`,
    userId: USER,
    cardId: CARD.id,
    accountId: 'bb',
    invoice: NOV,
    amountCents: cents,
    today: TODAY,
    nowIso: '2026-11-05T12:00:00.000Z',
    categoryId: 'cat-pag',
    description: 'Pagamento da fatura de nov/2026',
  });
}

const view = (rows: LocalRow<'transactions'>[], today = TODAY) =>
  invoiceView(CARD, '2026-11', rows.map(txFromRow), [], today);

describe('pagamento de fatura (US-19, RN-14..RN-16)', () => {
  it('US-19: pagamento total de R$ 1.200,00 saindo de "BB" → a fatura fica paga e o pagamento não é despesa', () => {
    const rows = [purchase('c', 120_000)];
    expect(view(rows).status).toBe('closed');
    const pay = payment(120_000);
    expect(pay).toMatchObject({
      kind: 'transfer',
      account_id: 'bb',
      card_id: null,
      counterpart_card_id: CARD.id,
      invoice_id: NOV.id,
      payment_method: 'transfer',
      category_id: 'cat-pag',
    });
    const paid = view([...rows, pay]);
    expect(paid.status).toBe('paid');
    expect(paid.totals.chargesCents).toBe(120_000);
    expect(paid.totalCents).toBe(120_000);
  });

  it('US-19: pagamento parcial de R$ 500,00 → "parcialmente paga" com "R$ 700,00 em aberto", sem juros', () => {
    const partial = view([purchase('c', 120_000), payment(50_000)]);
    expect(partial.status).toBe('partial');
    expect(partial.remainingCents).toBe(70_000);
    expect(invoiceStateLine(partial, false)).toBe('R$\u00a0700,00 em aberto');
    // depois do vencimento, sem pagar o resto: vencida, com o mesmo valor em aberto (nenhum juro)
    const late = view([purchase('c', 120_000), payment(50_000)], '2026-11-20');
    expect(late.status).toBe('overdue');
    expect(late.remainingCents).toBe(70_000);
  });

  it('US-19: pagamento de R$ 1.250,00 → paga, e dez/2026 recebe "Saldo credor da fatura anterior" de −R$ 50,00', () => {
    const rows = [purchase('c', 120_000), payment(125_000)];
    const invoices = [buildInvoice(NOV, USER, '2026-11-01T12:00:00.000Z')];
    expect(view(rows).status).toBe('paid');
    const plan = planCardData(
      CARD,
      invoices,
      rows,
      rows.map(txFromRow),
      TODAY,
      USER,
      '2026-11-05T12:00:00.000Z',
      null,
    );
    expect(plan.transactions).toHaveLength(1);
    expect(plan.transactions[0]).toMatchObject({
      kind: 'refund',
      amount_cents: 5_000,
      description: CARRY_OVER_DESCRIPTION,
      invoice_id: invoiceView(CARD, '2026-12', [], [], TODAY).period.id,
    });
    const after = [...rows, ...plan.transactions];
    const dec = invoiceView(CARD, '2026-12', after.map(txFromRow) as Tx[], [], TODAY);
    expect(dec.totalCents).toBe(-5_000);
    // idempotente
    expect(
      planCardData(
        CARD,
        [...invoices, ...plan.invoices],
        after,
        after.map(txFromRow),
        TODAY,
        USER,
        '2026-11-05T12:00:00.000Z',
        null,
      ).transactions,
    ).toEqual([]);
  });

  it('RN-16: padrão é a fechada/vencida mais antiga não paga; senão a aberta; só faturas com saldo', () => {
    const oct = invoiceView(CARD, '2026-10', [], [], TODAY);
    const nov = view([purchase('c', 120_000)]);
    const dec = invoiceView(CARD, '2026-12', [], [], TODAY);
    expect(defaultPaymentTarget([dec, nov, oct])?.period.referenceMonth).toBe('2026-11');
    expect(payableInvoices([dec, nov, oct]).map((v) => v.period.referenceMonth)).toEqual([
      '2026-11',
    ]);
    const openOnly = invoiceView(
      CARD,
      '2026-12',
      [
        txFromRow({
          ...purchase('d', 9_000),
          invoice_id: dec.period.id,
          occurred_on: dec.period.periodStart,
        }),
      ],
      [],
      TODAY,
    );
    expect(defaultPaymentTarget([openOnly])?.status).toBe('open');
    expect(defaultPaymentTarget([oct])).toBeNull();
  });
});

function mount(auth: AuthValue) {
  const router = createMemoryRouter(
    [{ path: '/cartoes/:cartaoId/fatura/:mes', element: <InvoiceScreen today={TODAY} /> }],
    { initialEntries: ['/cartoes/a/fatura/2026-11'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('C02 — Registrar pagamento (UX §3 C02)', () => {
  it('US-19: a folha vem com o saldo e a conta que paga; pagar parcial deixa "R$ 700,00 em aberto" e mostra o toast', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.cards.put(cardRow());
    await db.accounts.put(
      makeRow('accounts', { id: 'bb', name: 'BB', deleted_at: null, archived_at: null }),
    );
    await db.invoices.put(buildInvoice(NOV, USER, '2026-11-01T12:00:00.000Z'));
    await db.categories.put(
      makeRow('categories', { id: 'cat-pag', slug: 'pagamento-fatura', deleted_at: null }),
    );
    await db.transactions.put(purchase('c', 120_000));
    mount(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar pagamento' }));
    const sheet = await screen.findByTestId('pay-sheet');
    const amount = within(sheet).getByLabelText('Valor do pagamento');
    await waitFor(() => expect(amount).toHaveValue('R$\u00a01.200,00'));
    expect(within(sheet).getByLabelText('Conta de origem')).toHaveValue('bb');
    expect(within(sheet).getByLabelText('Fatura')).toHaveValue(NOV.id);
    fireEvent.keyDown(amount, { key: 'Delete' });
    for (const digit of '50000') {
      fireEvent.keyDown(amount, { key: digit });
    }
    expect(amount).toHaveValue('R$\u00a0500,00');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Registrar pagamento' }));
    expect(
      await screen.findByText('Pagamento da fatura de nov/2026 registrado.'),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('invoice-state')).toHaveTextContent('R$ 700,00 em aberto');
    const pays = (await db.transactions.toArray()).filter((r) => r.kind === 'transfer');
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({
      amount_cents: 50_000,
      account_id: 'bb',
      counterpart_card_id: 'a',
      invoice_id: NOV.id,
      category_id: 'cat-pag',
      description: 'Pagamento da fatura de nov/2026',
    });
  });

  it('acima do total avisa o saldo credor; sem conta pede para cadastrar', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.cards.put(cardRow());
    await db.transactions.put(purchase('c', 120_000));
    mount(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar pagamento' }));
    expect(
      await screen.findByText('Cadastre uma conta para registrar o pagamento.'),
    ).toBeInTheDocument();
    await db.accounts.put(
      makeRow('accounts', { id: 'bb', name: 'BB', deleted_at: null, archived_at: null }),
    );
    const sheet = await screen.findByTestId('pay-sheet');
    const amount = await within(sheet).findByLabelText('Valor do pagamento');
    fireEvent.keyDown(amount, { key: 'Delete' });
    for (const digit of '125000') {
      fireEvent.keyDown(amount, { key: digit });
    }
    expect(within(sheet).getByTestId('pay-over')).toHaveTextContent(
      'Acima do total: a diferença vira saldo credor na próxima fatura.',
    );
  });
});
