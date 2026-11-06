import { invoiceForPurchase, recurrenceTxId } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { cardFromRow, txFromRow } from '../src/data/mappers';
import { FutureScreen } from '../src/features/budget/FutureScreen';
import { committedNext, futureMonths } from '../src/features/budget/future';
import { methodTarget } from '../src/features/recurrences/ExpensesSection';
import { IncomeScreen, occurrenceText } from '../src/features/recurrences/IncomeScreen';
import {
  approxAmount,
  buildFixedExpense,
  confirmOccurrence,
  projectIncome,
  recurrenceFromRow,
  runAutoPosts,
} from '../src/features/recurrences/model';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const USER = '00000000-0000-7000-8000-000000000001';
const NOW = '2026-11-01T12:00:00.000Z';
const CARD_ROW: LocalRow<'cards'> = makeRow('cards', {
  id: 'a',
  name: 'Cartão A',
  closing_day: 3,
  due_day: 10,
  closing_day_rule: 'next',
  limit_cents: null,
  deleted_at: null,
  archived_at: null,
});

function luz() {
  return buildFixedExpense({
    id: 'rec-luz',
    userId: USER,
    description: 'Luz',
    amountCents: 18_000,
    dayOfMonth: 20,
    accountId: 'bb',
    cardId: null,
    categoryId: null,
    variable: true,
    startOn: '2026-11-01',
    nowIso: NOW,
  });
}

function streaming() {
  return buildFixedExpense({
    id: 'rec-stream',
    userId: USER,
    description: 'Streaming',
    amountCents: 3_990,
    dayOfMonth: 15,
    accountId: null,
    cardId: 'a',
    categoryId: null,
    variable: false,
    startOn: '2026-11-01',
    nowIso: NOW,
  });
}

const domain = (row: LocalRow<'recurrences'>) => {
  const rec = recurrenceFromRow(row);
  if (!rec) {
    throw new Error('recorrência inválida');
  }
  return rec;
};

describe('recurrences — contas fixas e assinaturas (US-25, RN-26..RN-31)', () => {
  it('US-25: "Luz" ≈ R$ 180,00 todo dia 20 no Pix BB aparece como prevista "≈ R$ 180,00" e, em 21/11, atrasada', () => {
    const rec = domain(luz());
    expect(luz()).toMatchObject({
      kind: 'expense',
      payment_method: 'pix',
      auto_post: false,
      is_variable_amount: true,
    });
    const [nov] = projectIncome([rec], [], '2026-11-05');
    if (!nov) {
      throw new Error('sem ocorrência');
    }
    const approx = approxAmount(rec, []);
    expect(
      occurrenceText(nov, undefined, '2026-11-05', false, { kind: 'expense', approxCents: approx }),
    ).toBe('Prevista para 20/11/2026 · ≈ R$ 180,00');
    expect(
      occurrenceText(nov, undefined, '2026-11-21', false, { kind: 'expense', approxCents: approx }),
    ).toBe('Atrasada desde 20/11/2026 · ≈ R$ 180,00');
  });

  it('US-25: confirmar a luz de novembro com R$ 203,45 efetiva e a próxima mostra "≈ R$ 203,45" (RN-31)', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    const rec = domain(luz());
    await confirmOccurrence(db, USER, rec, '2026-11-20', 20_345);
    const row = await db.transactions.get(recurrenceTxId('rec-luz', '2026-11-20'));
    expect(row).toMatchObject({
      status: 'posted',
      amount_cents: 20_345,
      kind: 'expense',
      account_id: 'bb',
    });
    const txs = (await db.transactions.toArray()).map(txFromRow);
    expect(approxAmount(rec, txs)).toBe(20_345);
    const dec = projectIncome([rec], txs, '2026-12-01')[0];
    if (!dec) {
      throw new Error('sem dezembro');
    }
    expect(
      occurrenceText(dec, undefined, '2026-12-01', false, { kind: 'expense', approxCents: 20_345 }),
    ).toBe('Prevista para 20/12/2026 · ≈ R$ 203,45');
  });

  it('US-25: "Streaming" R$ 39,90 todo dia 15 no cartão A vem com confirmação automática e 15/11/2026 entra na fatura dez/2026', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.cards.put(CARD_ROW);
    expect(streaming()).toMatchObject({
      auto_post: true,
      payment_method: 'credit',
      card_id: 'a',
      account_id: null,
    });
    const rec = domain(streaming());
    // RN-28: na abertura depois do dia 15, a ocorrência vencida é confirmada sozinha
    expect(await runAutoPosts(db, USER, [rec], [], '2026-11-16')).toBe(1);
    const row = await db.transactions.get(recurrenceTxId('rec-stream', '2026-11-15'));
    const dec = invoiceForPurchase(cardFromRow(CARD_ROW), '2026-11-15');
    expect(dec.referenceMonth).toBe('2026-12');
    expect(row).toMatchObject({
      card_id: 'a',
      invoice_id: dec.id,
      amount_cents: 3_990,
      status: 'posted',
    });
    expect(await db.invoices.get(dec.id)).toBeDefined();
    // idempotente: a segunda abertura não confirma de novo
    const txs = (await db.transactions.toArray()).map(txFromRow);
    expect(await runAutoPosts(db, USER, [rec], txs, '2026-11-16')).toBe(0);
  });

  it('US-25: anual no dia 31 de fevereiro ocorre no último dia de fevereiro', () => {
    const rec = domain({
      ...luz(),
      id: 'anual',
      frequency: 'yearly',
      month_of_year: 2,
      day_of_month: 31,
      start_on: '2026-01-01',
    });
    const dates = projectIncome([rec], [], '2026-11-05').map((o) => o.date);
    expect(dates).toEqual(['2027-02-28']);
  });

  it('meio da conta fixa: "pix:<conta>" ou "card:<cartão>"', () => {
    expect(methodTarget('pix:bb')).toEqual({ accountId: 'bb', cardId: null });
    expect(methodTarget('card:a')).toEqual({ accountId: null, cardId: 'a' });
  });
});

describe('P03 — Futuro (UX §3 P03)', () => {
  it('US-25: próximos 12 meses com parcelas pelo mês da fatura e contas fixas projetadas; "Comprometido nos próximos 3 meses"', () => {
    const card = cardFromRow(CARD_ROW);
    const parcels = [2, 3].map((k) => {
      const month = k === 2 ? '2027-01' : '2027-02';
      return tx(`p${k}`, {
        kind: 'expense',
        series_id: 's',
        installment_number: k,
        installment_count: 3,
        amount_cents: 25_000,
        description: 'Geladeira',
        card_id: 'a',
        invoice_id: `inv-${month}`,
        deleted_at: null,
        status: 'posted',
      });
    });
    const invoices = ['2027-01', '2027-02'].map((m) =>
      makeRow('invoices', { id: `inv-${m}`, card_id: card.id, reference_month: `${m}-01` }),
    );
    const months = futureMonths({
      today: '2026-12-10',
      txRows: parcels,
      invoices,
      recurrences: [domain({ ...luz(), is_variable_amount: false })],
      txs: [],
    });
    expect(months).toHaveLength(12);
    expect(months[0]).toMatchObject({
      month: '2027-01',
      installmentsCents: 25_000,
      fixedCents: 18_000,
    });
    expect(months[1]).toMatchObject({
      month: '2027-02',
      installmentsCents: 25_000,
      fixedCents: 18_000,
    });
    expect(months[2]).toMatchObject({ month: '2027-03', installmentsCents: 0, fixedCents: 18_000 });
    expect(committedNext(months)).toBe(25_000 * 2 + 18_000 * 3);
    expect(months[0]?.items.map((i) => [i.kind, i.description, i.detail])).toEqual([
      ['installment', 'Geladeira', '2/3'],
      ['fixed', 'Luz', '20'],
    ]);
  });

  it('P03: vazio, resumo, tabela alternativa e toque na parcela leva à T02', async () => {
    const empty = fakeAuth('signedIn');
    const first = mountFuture(empty);
    expect(
      await screen.findByText('Nenhum valor comprometido nos próximos meses.'),
    ).toBeInTheDocument();
    first.unmount();
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.recurrences.put({ ...luz(), is_variable_amount: false });
    await db.invoices.put(
      makeRow('invoices', { id: 'inv-jan', card_id: 'a', reference_month: '2027-01-01' }),
    );
    await db.cards.put(CARD_ROW);
    await db.transactions.put(
      tx('p2', {
        kind: 'expense',
        series_id: 's',
        installment_number: 2,
        installment_count: 3,
        amount_cents: 25_000,
        description: 'Geladeira',
        card_id: 'a',
        invoice_id: 'inv-jan',
        deleted_at: null,
        status: 'posted',
      }),
    );
    const view = mountFuture(auth);
    expect(await screen.findByTestId('future-summary')).toHaveTextContent(
      'Comprometido nos próximos 3 meses: R$ 790,00',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver como tabela' }));
    const table = screen.getByTestId('future-table');
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    const jan = screen.getByTestId('future-2027-01');
    fireEvent.click(within(jan).getByRole('button', { name: /Geladeira/ }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/lancamentos/p2'));
  });
});

function mountFuture(auth: AuthValue) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <FutureScreen today="2026-12-10" /> },
      { path: '/lancamentos/:id', element: <p>t02</p> },
      { path: '/ajustes/renda', element: <p>s05</p> },
    ],
    { initialEntries: ['/'] },
  );
  const result = render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return { router, unmount: result.unmount };
}

describe('S05 — contas fixas (UX §3 S01)', () => {
  it('US-25: cadastra "Luz" variável no Pix, confirma com R$ 203,45 e pula a de outra conta', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.accounts.put(
      makeRow('accounts', {
        id: 'bb',
        name: 'BB',
        type: 'checking',
        deleted_at: null,
        archived_at: null,
      }),
    );
    await db.cards.put(CARD_ROW);
    const router = createMemoryRouter([
      { path: '*', element: <IncomeScreen today="2026-11-05" /> },
    ]);
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Nenhuma conta fixa cadastrada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nova conta fixa' }));
    const sheet = await screen.findByTestId('expense-sheet');
    fireEvent.change(within(sheet).getByLabelText('Descrição'), { target: { value: 'Luz' } });
    const amount = within(sheet).getByLabelText('Valor');
    for (const d of '18000') {
      fireEvent.keyDown(amount, { key: d });
    }
    fireEvent.change(within(sheet).getByLabelText('Dia do mês'), { target: { value: '20' } });
    expect(within(sheet).getByLabelText('Pago com')).toHaveValue('pix:bb');
    expect(within(sheet).getByRole('switch', { name: 'Confirmação automática' })).not.toBeChecked();
    fireEvent.change(within(sheet).getByLabelText('Pago com'), { target: { value: 'card:a' } });
    expect(within(sheet).getByRole('switch', { name: 'Confirmação automática' })).toBeChecked();
    fireEvent.change(within(sheet).getByLabelText('Pago com'), { target: { value: 'pix:bb' } });
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Valor variável' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByTestId('expense-current')).toHaveTextContent(
      'Prevista para 20/11/2026 · ≈ R$ 180,00',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    const confirm = await screen.findByTestId('expense-confirm-sheet');
    const real = within(confirm).getByLabelText('Valor');
    fireEvent.keyDown(real, { key: 'Delete' });
    for (const d of '20345') {
      fireEvent.keyDown(real, { key: d });
    }
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(screen.getByTestId('expense-current')).toHaveTextContent(
        'Paga em 20/11/2026 · R$ 203,45',
      ),
    );
    expect(screen.getByTestId('expense-upcoming')).toHaveTextContent('≈ R$ 203,45');
    const [rec] = await db.recurrences.toArray();
    expect(rec).toMatchObject({
      description: 'Luz',
      is_variable_amount: true,
      auto_post: false,
      day_of_month: 20,
    });
  });
});
