import { CARRY_OVER_DESCRIPTION, type Card, reassignCardItems, type Tx } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { cardFromRow, txFromRow } from '../src/data/mappers';
import { CardsScreen, invoiceStateLine } from '../src/features/cards/CardsScreen';
import { brandColor } from '../src/features/cards/data';
import { InvoiceScreen } from '../src/features/cards/InvoiceScreen';
import {
  cardOverview,
  daysBetween,
  invoiceView,
  movedRow,
  moveTargets,
  planCardData,
} from '../src/features/cards/model';
import { movePlan } from '../src/features/cards/move';
import { buildInvoice } from '../src/features/quick-entry/model';
import { TransactionDetailScreen } from '../src/features/transactions/TransactionDetailScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-15';
const USER = '00000000-0000-7000-8000-000000000001';

function cardRow(overrides: Partial<LocalRow<'cards'>> = {}): LocalRow<'cards'> {
  return makeRow('cards', {
    id: 'a',
    name: 'Cartão A',
    closing_day: 3,
    due_day: 10,
    closing_day_rule: 'next',
    limit_cents: null,
    deleted_at: null,
    archived_at: null,
    color: null,
    last4: null,
    sort_order: 0,
    ...overrides,
  });
}

const CARD: Card = cardFromRow(cardRow());

function invoiceRow(card: Card, month: string): LocalRow<'invoices'> {
  const view = invoiceView(card, month as never, [], [], TODAY);
  return { ...buildInvoice(view.period, USER, '2026-11-01T12:00:00.000Z'), is_manual_dates: false };
}

function cardTx(
  id: string,
  card: Card,
  month: string,
  cents: number,
  overrides: Partial<LocalRow<'transactions'>> = {},
): LocalRow<'transactions'> {
  const view = invoiceView(card, month as never, [], [], TODAY);
  return tx(id, {
    kind: 'expense',
    status: 'posted',
    amount_cents: cents,
    card_id: card.id,
    account_id: null,
    invoice_id: view.period.id,
    payment_method: 'credit',
    occurred_on: view.period.periodStart,
    review_state: 'ok',
    deleted_at: null,
    series_id: null,
    recurrence_id: null,
    ...overrides,
  });
}

const toTxs = (rows: readonly LocalRow<'transactions'>[]): Tx[] => rows.map(txFromRow);

describe('faturas do cartão (US-18, RN-13..RN-15)', () => {
  it('US-18: hoje 15/11/2026, cartão A (F=3, V=10): dez/2026 aberta, fecha em 03/12 (18 dias), com total parcial', () => {
    const rows = [
      cardTx('c1', CARD, '2026-12', 12_000),
      cardTx('c2', CARD, '2027-01', 25_000, {
        series_id: 's',
        installment_number: 2,
        installment_count: 10,
      }),
    ];
    const o = cardOverview(CARD, toTxs(rows), [], TODAY);
    expect(o.current.period.referenceMonth).toBe('2026-12');
    expect(o.current.status).toBe('open');
    expect(o.current.totalCents).toBe(12_000);
    expect(daysBetween(TODAY, o.current.period.closingDate)).toBe(18);
    expect(invoiceStateLine(o.current, false)).toBe('Fecha em 03/12 (18 dias)');
    expect(o.upcoming.map((v) => [v.period.referenceMonth, v.status, v.totalCents])).toEqual([
      ['2027-01', 'future', 25_000],
      ['2027-02', 'future', 0],
      ['2027-03', 'future', 0],
    ]);
  });

  it('US-18: anteriores com status em texto (paga, vencida, parcialmente paga)', () => {
    const invoices = ['2026-08', '2026-09', '2026-10', '2026-11'].map((m) => invoiceRow(CARD, m));
    const pay = (id: string, month: string, cents: number) =>
      cardTx(id, CARD, month, cents, {
        kind: 'transfer',
        card_id: null,
        account_id: 'bb',
        counterpart_card_id: CARD.id,
        payment_method: 'transfer',
      });
    const rows = [
      cardTx('n', CARD, '2026-11', 120_000),
      cardTx('o', CARD, '2026-10', 50_000),
      pay('po', '2026-10', 50_000),
      cardTx('s', CARD, '2026-09', 30_000),
    ];
    const o = cardOverview(CARD, toTxs(rows), invoices, TODAY);
    expect(o.previous.map((v) => [v.period.referenceMonth, v.status])).toEqual([
      ['2026-11', 'overdue'],
      ['2026-10', 'paid'],
      ['2026-09', 'overdue'],
    ]);
    const partial = invoiceView(
      CARD,
      '2026-12',
      toTxs([cardTx('d', CARD, '2026-12', 10_000), pay('pd', '2026-12', 4_000)]),
      [],
      '2026-12-05',
    );
    expect(partial.status).toBe('partial');
    expect(invoiceStateLine(partial, false)).toBe('R$ 60,00 em aberto');
  });

  it('US-18: fatura nov/2026 de R$ 1.200,00 sem pagamento, hoje 11/11/2026 → vencida com "R$ 1.200,00 em aberto"', () => {
    const view = invoiceView(
      CARD,
      '2026-11',
      toTxs([cardTx('n', CARD, '2026-11', 120_000)]),
      [],
      '2026-11-11',
    );
    expect(view.status).toBe('overdue');
    expect(invoiceStateLine(view, false)).toBe('R$ 1.200,00 em aberto');
    expect(invoiceStateLine(view, true)).toBe('R$ •••• em aberto');
  });

  it('US-18: fatura nov/2026 fechada com total −R$ 30,00 → dez/2026 recebe "Saldo credor da fatura anterior" de −R$ 30,00', () => {
    const invoices = [invoiceRow(CARD, '2026-11')];
    const rows = [
      cardTx('compra', CARD, '2026-11', 1_000),
      cardTx('estorno', CARD, '2026-11', 4_000, { kind: 'refund' }),
    ];
    const plan = planCardData(
      CARD,
      invoices,
      rows,
      toTxs(rows),
      TODAY,
      USER,
      '2026-11-15T12:00:00.000Z',
      'cat-saldo',
    );
    expect(plan.invoices.map((i) => i.reference_month)).toEqual([
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
    ]);
    expect(plan.transactions).toHaveLength(1);
    const credit = plan.transactions[0];
    expect(credit).toMatchObject({
      kind: 'refund',
      amount_cents: 3_000,
      description: CARRY_OVER_DESCRIPTION,
      invoice_id: invoiceView(CARD, '2026-12', [], [], TODAY).period.id,
      invoice_pinned: true,
      source: 'system',
      category_id: 'cat-saldo',
    });
    // idempotente: com o saldo credor e as faturas já gravados, nada a fazer
    const after = [...rows, ...plan.transactions];
    const again = planCardData(
      CARD,
      [...invoices, ...plan.invoices],
      after,
      toTxs(after),
      TODAY,
      USER,
      '2026-11-15T12:00:00.000Z',
      'cat-saldo',
    );
    expect(again).toEqual({ invoices: [], transactions: [] });
    const dec = invoiceView(CARD, '2026-12', toTxs(after), [], TODAY);
    expect(dec.totalCents).toBe(-3_000);
  });

  it('RN-18: mover item para jan/2027 fixa a fatura e não recalcula se o fechamento mudar', () => {
    const row = cardTx('m', CARD, '2026-12', 5_000);
    const targets = moveTargets(CARD, txFromRow(row), toTxs([row]), [], TODAY);
    // nov/2026 já fechou sem valor (conta como paga) e fica de fora
    expect(targets.map((p) => p.referenceMonth)).toEqual(['2027-01', '2027-02', '2027-03']);
    const jan = targets.find((p) => p.referenceMonth === '2027-01');
    if (!jan) {
      throw new Error('sem jan/2027');
    }
    const moved = movedRow(row, jan);
    expect(moved).toMatchObject({ invoice_id: jan.id, invoice_pinned: true });
    const changed = { ...CARD, closingDay: 20, dueDay: 27 };
    expect(reassignCardItems(CARD, changed, [txFromRow(moved)], TODAY)).toEqual([]);
  });

  it('RN-18: fatura paga não deixa mover; transferência e item sem cartão também não', () => {
    const invoices = [invoiceRow(CARD, '2026-10')];
    const row = cardTx('p', CARD, '2026-10', 5_000);
    const pay = cardTx('pp', CARD, '2026-10', 5_000, {
      kind: 'transfer',
      card_id: null,
      account_id: 'bb',
      counterpart_card_id: CARD.id,
      payment_method: 'transfer',
    });
    expect(movePlan(cardRow(), row, [row, pay], invoices, TODAY)?.allowed).toBe(false);
    expect(movePlan(cardRow(), { ...row, card_id: null }, [], invoices, TODAY)).toBeNull();
    expect(movePlan(cardRow({ closing_day_rule: 'x' }), row, [], invoices, TODAY)).toBeNull();
    const open = cardTx('o', CARD, '2026-12', 5_000);
    expect(movePlan(cardRow(), open, [open], [], TODAY)?.allowed).toBe(true);
  });

  it('limite usado e cor do cartão', () => {
    const card = cardFromRow(cardRow({ limit_cents: 100_000 }));
    const o = cardOverview(card, toTxs([cardTx('x', card, '2026-12', 30_000)]), [], TODAY);
    expect([o.limitCents, o.usedCents]).toEqual([100_000, 30_000]);
    expect(brandColor('violet')).toBe('violet');
    expect(brandColor(null)).toBe('graphite');
  });
});

function mount(auth: AuthValue, path: string) {
  const router = createMemoryRouter(
    [
      { path: '/cartoes', element: <CardsScreen today={TODAY} /> },
      { path: '/cartoes/:cartaoId/fatura/:mes', element: <InvoiceScreen today={TODAY} /> },
      { path: '/lancamentos/:id', element: <TransactionDetailScreen today={TODAY} /> },
      { path: '/ajustes/contas', element: <p>contas</p> },
    ],
    { initialEntries: [path] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  return router;
}

describe('C01 e C02 (UX §3)', () => {
  it('C01 sem cartões: vazio com "Adicionar cartão"', async () => {
    const auth = fakeAuth('signedIn');
    const router = mount(auth, '/cartoes');
    expect(await screen.findByText('Nenhum cartão cadastrado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar cartão' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes/contas'));
  });

  it('US-18: C01 mostra a fatura aberta, grava as faturas que faltam e leva à C02', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.cards.put(cardRow({ limit_cents: 100_000 }));
    await db.cards.put(cardRow({ id: 'b', name: 'Cartão B', sort_order: 1 }));
    await db.transactions.put(cardTx('c1', CARD, '2026-12', 12_000));
    const router = mount(auth, '/cartoes');
    expect(await screen.findByTestId('cards-state')).toHaveTextContent('Fecha em 03/12 (18 dias)');
    // T-123 (UXB-011): o card de baixo tem o mês como título; nome e total ficam só no cartão
    expect(
      screen.getByRole('heading', { name: 'Fatura de dez/2026', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('card-a')).toHaveTextContent('Fecha em 03/12 · Vence em 10/12');
    expect(
      screen.getByLabelText('Cartão A, fatura de dez/2026, R$ 120,00, vence em 10/12'),
    ).toHaveAttribute('aria-roledescription', 'cartão');
    expect(screen.getByTestId('cards-upcoming')).toHaveTextContent('jan/2027 · vence 10/01/2027');
    await waitFor(async () => expect(await db.invoices.count()).toBe(8));
    fireEvent.click(screen.getByRole('button', { name: 'Próximo cartão' }));
    await waitFor(() =>
      expect(
        screen.getByTestId('card-b').closest('[aria-roledescription="cartão"]'),
      ).toHaveAttribute('data-selected', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cartão anterior' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver fatura' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cartoes/a/fatura/2026-12'));
    expect(await screen.findByTestId('invoice-items')).toBeInTheDocument();
    // T-123 (UXB-021): aberta numa linha só
    expect(screen.getByTestId('invoice-state')).toHaveTextContent(
      'Fecha em 03/12 (18 dias) · Vence em 10/12',
    );
    expect(screen.getByTestId('invoice-head')).not.toHaveTextContent('Fecha em 03/12 · Vence');
    fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(await screen.findByText('Nenhuma compra nesta fatura')).toBeInTheDocument(); // US-63, UX §6.5
    expect(
      screen.getByText('Fatura futura: mostra parcelas e contas fixas já previstas.'),
    ).toBeInTheDocument();
  });

  it('C02 de cartão inexistente volta para a C01', async () => {
    const auth = fakeAuth('signedIn');
    const router = mount(auth, '/cartoes/nao-existe/fatura/2026-12');
    expect(await screen.findByText('Cartão não encontrado.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para cartões' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cartoes'));
  });

  it('US-18: na T02, "Mover para outra fatura" leva o item para jan/2027 com a fatura fixada', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.cards.put(cardRow());
    await db.invoices.put(invoiceRow(CARD, '2026-12'));
    await db.transactions.put(cardTx('m', CARD, '2026-12', 5_000));
    mount(auth, '/lancamentos/m');
    fireEvent.click(await screen.findByRole('button', { name: 'Mover para outra fatura' }));
    const dialog = await screen.findByTestId('move-dialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Mover para a fatura de jan/2027' }),
    );
    const jan = invoiceView(CARD, '2027-01', [], [], TODAY).period.id;
    await waitFor(async () =>
      expect(await db.transactions.get('m')).toMatchObject({
        invoice_id: jan,
        invoice_pinned: true,
      }),
    );
    expect(await db.invoices.get(jan)).toBeDefined();
    expect(
      await screen.findByText('Lançamento movido para a fatura de jan/2027.'),
    ).toBeInTheDocument();
  });
});
