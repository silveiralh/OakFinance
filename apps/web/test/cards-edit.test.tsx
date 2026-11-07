import { addMonths, type ISODate, invoiceForPurchase, invoicePeriod } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow, OakDb } from '../src/data/db';
import { cardFromRow } from '../src/data/mappers';
import {
  changeCandidates,
  datesChanged,
  unarchiveCard,
  updateCard,
} from '../src/data/repositories/card-edit';
import { archiveCard } from '../src/data/repositories/cards';
import { CardsSection } from '../src/features/accounts/CardsSection';
import { TransactionDetailScreen } from '../src/features/transactions/TransactionDetailScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-15';

function cardRow(overrides: Partial<LocalRow<'cards'>> = {}): LocalRow<'cards'> {
  return makeRow('cards', {
    id: 'a',
    name: 'Cartão A',
    closing_day: 3,
    due_day: 10,
    closing_day_rule: 'next',
    limit_cents: null,
    payment_account_id: null,
    deleted_at: null,
    archived_at: null,
    sort_order: 0,
    ...overrides,
  });
}

const CARD = cardFromRow(cardRow());

function purchase(
  id: string,
  date: ISODate,
  overrides: Partial<LocalRow<'transactions'>> = {},
): LocalRow<'transactions'> {
  const shift = (overrides.installment_number ?? 1) - 1;
  const first = invoiceForPurchase(CARD, date);
  const month = addMonths(first.referenceMonth, shift);
  return tx(id, {
    kind: 'expense',
    status: 'posted',
    amount_cents: 1_000,
    card_id: CARD.id,
    account_id: null,
    payment_method: 'credit',
    occurred_on: date,
    invoice_id: invoicePeriod(CARD, month).id,
    invoice_pinned: false,
    deleted_at: null,
    ...overrides,
  });
}

/** Cenário da US-11: 4 itens na fatura aberta, 2 parcelas em faturas futuras, 3 na fechada e 1 fixado. */
async function scenario(db: OakDb) {
  await db.cards.put(cardRow());
  const series = { series_id: 's', installment_count: 3 };
  const rows = [
    purchase('ab1', '2026-11-04'),
    purchase('ab2', '2026-11-08'),
    purchase('ab3', '2026-11-12'),
    purchase('p1', '2026-11-10', { ...series, installment_number: 1 }),
    purchase('p2', '2026-11-10', { ...series, installment_number: 2 }),
    purchase('p3', '2026-11-10', { ...series, installment_number: 3 }),
    purchase('f1', '2026-10-05'),
    purchase('f2', '2026-10-20'),
    purchase('f3', '2026-11-01'),
    purchase('fix', '2026-11-06', { invoice_pinned: true }),
  ];
  await db.transactions.bulkPut(rows);
  return rows;
}

describe('cards — editar cartão (US-11, RN-17, RN-18)', () => {
  it('US-11: mudar o fechamento de 3 para 8 → "6 itens podem mudar de fatura"; só aberta e futuras mudam; fixado fica', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    const rows = await scenario(db);
    expect(
      changeCandidates(CARD, rows, [], TODAY)
        .map((r) => r.id)
        .sort(),
    ).toEqual(['ab1', 'ab2', 'ab3', 'p1', 'p2', 'p3']);
    const input = { name: 'Cartão A', closingDay: 8, dueDay: 10 };
    expect(datesChanged(cardRow(), input)).toBe(true);
    expect(datesChanged(cardRow(), { name: 'Outro', closingDay: 3, dueDay: 10 })).toBe(false);
    const before = new Map(rows.map((r) => [r.id, r.invoice_id]));
    const result = await updateCard(db, 'a', input, TODAY);
    if (!result.ok) {
      throw new Error(result.error.code);
    }
    expect(result.value.card).toMatchObject({ closing_day: 8, due_day: 10 });
    const after = new Map((await db.transactions.toArray()).map((r) => [r.id, r]));
    // fechada e fixado não mudam
    for (const id of ['f1', 'f2', 'f3', 'fix']) {
      expect(after.get(id)?.invoice_id, id).toBe(before.get(id));
    }
    // aberta e futuras seguem a RN-12 com o cartão novo (parcela k em F1 + k − 1)
    const newCard = cardFromRow(result.value.card);
    for (const id of ['ab1', 'ab2', 'ab3', 'p1', 'p2', 'p3']) {
      const row = after.get(id);
      const shift = (row?.installment_number ?? 1) - 1;
      const month = addMonths(
        invoiceForPurchase(newCard, row?.occurred_on as ISODate).referenceMonth,
        shift,
      );
      expect(row?.invoice_id, id).toBe(invoicePeriod(newCard, month).id);
    }
    expect(result.value.moved).toBe(
      ['ab1', 'ab2', 'ab3', 'p1', 'p2', 'p3'].filter(
        (id) => after.get(id)?.invoice_id !== before.get(id),
      ).length,
    );
    // as faturas de destino existem
    const invoiceIds = new Set((await db.invoices.toArray()).map((i) => i.id));
    for (const id of ['ab1', 'ab2', 'ab3', 'p1', 'p2', 'p3']) {
      const target = after.get(id)?.invoice_id;
      if (target !== before.get(id)) {
        expect(invoiceIds.has(target ?? ''), id).toBe(true);
      }
    }
  });

  it('nome repetido e dia inválido são recusados; arquivar e desarquivar', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.cards.put(cardRow());
    await db.cards.put(cardRow({ id: 'b', name: 'Cartão B', sort_order: 1 }));
    const dup = await updateCard(db, 'a', { name: 'cartão b', closingDay: 3, dueDay: 10 }, TODAY);
    expect(dup.ok ? null : dup.error.code).toBe('CARD_NAME');
    const day = await updateCard(db, 'a', { name: 'Cartão A', closingDay: 32, dueDay: 10 }, TODAY);
    expect(day.ok ? null : day.error.code).toBe('CARD_DAY');
    const missing = await updateCard(db, 'x', { name: 'X', closingDay: 3, dueDay: 10 }, TODAY);
    expect(missing.ok ? null : missing.error.code).toBe('CARD_NOT_FOUND');
    const plain = await updateCard(
      db,
      'a',
      { name: 'Cartão A2', closingDay: 3, dueDay: 10, limitCents: 50_000 },
      TODAY,
    );
    expect(plain.ok && plain.value).toMatchObject({
      moved: 0,
      card: { name: 'Cartão A2', limit_cents: 50_000 },
    });
    await archiveCard(db, 'b');
    expect((await db.cards.get('b'))?.archived_at).not.toBeNull();
    expect((await unarchiveCard(db, 'b')).ok).toBe(true);
    expect((await db.cards.get('b'))?.archived_at).toBeNull();
  });
});

function mount(auth: AuthValue, path = '/') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <CardsSection today={TODAY} /> },
      { path: '/lancamentos/:id', element: <TransactionDetailScreen today={TODAY} /> },
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
}

describe('S03 — editar e arquivar (US-11)', () => {
  it('US-11: pela tela, o fechamento 3 → 8 pede a confirmação com "6 itens podem mudar de fatura"', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await scenario(db);
    mount(auth);
    const row = await screen.findByTestId('card-a');
    // com lançamentos, só Arquivar (sem Excluir)
    await waitFor(() => expect(within(row).queryByRole('button', { name: 'Excluir' })).toBeNull());
    fireEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    const sheet = await screen.findByTestId('card-edit-sheet');
    expect(within(sheet).getByLabelText('Dia de fechamento')).toHaveValue('3');
    fireEvent.change(within(sheet).getByLabelText('Dia de fechamento'), { target: { value: '8' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar alterações' }));
    const dialog = await screen.findByTestId('card-move-dialog');
    expect(dialog).toHaveTextContent('6 itens podem mudar de fatura');
    // o <dialog> entra no DOM antes de abrir (showModal no efeito): espera o botão ficar acessível
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Confirmar' }));
    await waitFor(async () => expect((await db.cards.get('a'))?.closing_day).toBe(8));
    expect(await screen.findByText('Cartão atualizado.')).toBeInTheDocument();
  });

  it('US-11: cartão sem uso pode ser excluído; arquivado vai para "Cartões arquivados" e volta', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.cards.put(cardRow());
    mount(auth);
    const row = await screen.findByTestId('card-a');
    expect(await within(row).findByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Arquivar' }));
    const archived = await screen.findByTestId('cards-archived');
    fireEvent.click(within(archived).getByRole('button', { name: 'Desarquivar' }));
    await waitFor(async () => expect((await db.cards.get('a'))?.archived_at).toBeNull());
  });

  it('US-11: lançamento de conta arquivada continua com o nome e o selo "arquivada" na T02', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.accounts.put(
      makeRow('accounts', {
        id: 'cart',
        name: 'Carteira',
        deleted_at: null,
        archived_at: '2026-11-10T12:00:00.000Z',
      }),
    );
    await db.transactions.put(
      tx('l1', { account_id: 'cart', card_id: null, payment_method: 'cash', deleted_at: null }),
    );
    mount(auth, '/lancamentos/l1');
    expect(await screen.findByText('Carteira · arquivada')).toBeInTheDocument();
  });
});
