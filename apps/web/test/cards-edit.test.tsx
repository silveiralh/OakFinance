import {
  addMonths,
  type Card,
  invoiceForPurchase,
  invoiceId,
  invoicePeriod,
  type YearMonth,
} from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { cardFromRow } from '../src/data/mappers';
import { accountInUse } from '../src/data/repositories/accounts';
import { cardInUse, removeCard, unarchiveCard } from '../src/data/repositories/cards';
import { AccountsScreen } from '../src/features/accounts/AccountsScreen';
import { CardsSection, willMoveText } from '../src/features/accounts/CardsSection';
import { editCard } from '../src/features/cards/edit';
import { planCardChange } from '../src/features/cards/model';
import { buildInvoice } from '../src/features/quick-entry/model';
import { accountLabel, cardLabel } from '../src/features/transactions/list';
import { TransactionDetailScreen } from '../src/features/transactions/TransactionDetailScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

// Relógio em 05/11/2026. Cartão A fecha dia 3 e vence dia 10 (regra "próxima"): a fatura aberta é dez/2026
// (compras de 03/11 a 02/12), a fechada é nov/2026 (compras de 03/10 a 02/11).
const TODAY = '2026-11-05';
const USER = '00000000-0000-7000-8000-000000000001';
const CARD_ID = '00000000-0000-7000-8000-0000000000ca';

function cardRow(overrides: Partial<LocalRow<'cards'>> = {}): LocalRow<'cards'> {
  return makeRow('cards', {
    id: CARD_ID,
    user_id: USER,
    name: 'Cartão A',
    closing_day: 3,
    due_day: 10,
    closing_day_rule: 'next',
    limit_cents: null,
    payment_account_id: null,
    deleted_at: null,
    archived_at: null,
    color: null,
    last4: null,
    sort_order: 0,
    ...overrides,
  });
}

const OLD: Card = cardFromRow(cardRow());
const NEW: Card = { ...OLD, closingDay: 8 };

function invoiceOf(card: Card, month: YearMonth): LocalRow<'invoices'> {
  return buildInvoice(invoicePeriod(card, month), USER, '2026-11-01T12:00:00.000Z');
}

function buy(
  id: string,
  on: string,
  overrides: Partial<LocalRow<'transactions'>> = {},
): LocalRow<'transactions'> {
  const base = invoiceForPurchase(OLD, on as never).referenceMonth;
  const shift = (overrides.installment_number ?? 1) - 1;
  return tx(id, {
    kind: 'expense',
    amount_cents: 1_000,
    card_id: CARD_ID,
    account_id: null,
    invoice_id: invoiceId(CARD_ID, addMonths(base, shift)),
    payment_method: 'credit',
    occurred_on: on,
    deleted_at: null,
    series_id: null,
    recurrence_id: null,
    ...overrides,
  });
}

/** 4 itens na fatura aberta (um é a 1ª de 3 parcelas), 2 parcelas nas futuras, 3 na fechada e 1 fixado. */
function scenario(): LocalRow<'transactions'>[] {
  const parcel = (n: number) =>
    buy(`p${n}`, '2026-11-04', {
      installment_number: n,
      installment_count: 3,
      series_id: '00000000-0000-7000-8000-0000000000aa',
    });
  return [
    buy('o1', '2026-11-03'),
    buy('o2', '2026-11-04'),
    buy('o3', '2026-11-05'),
    parcel(1),
    parcel(2),
    parcel(3),
    buy('c1', '2026-10-10'),
    buy('c2', '2026-10-20'),
    buy('c3', '2026-11-01'),
    buy('fix', '2026-11-04', { invoice_pinned: true }),
  ];
}

describe('US-11 editar cartão (RN-17)', () => {
  it('RN-17: o cenário montado tem 4 itens na fatura aberta, 2 nas futuras e 3 na fechada', () => {
    const rows = scenario();
    const dec = invoiceId(CARD_ID, '2026-12');
    const nov = invoiceId(CARD_ID, '2026-11');
    expect(rows.filter((r) => r.invoice_id === dec && !r.invoice_pinned)).toHaveLength(4);
    expect(rows.filter((r) => r.invoice_id === nov)).toHaveLength(3);
    expect(rows.filter((r) => r.id === 'p2' || r.id === 'p3').map((r) => r.invoice_id)).toEqual([
      invoiceId(CARD_ID, '2027-01'),
      invoiceId(CARD_ID, '2027-02'),
    ]);
  });

  it('US-11: mudar o fechamento de 3 para 8 mostra "6 itens podem mudar de fatura"; fechada e fixado não mudam', () => {
    const rows = scenario();
    const invoices = (['2026-11', '2026-12', '2027-01'] as const).map((m) => invoiceOf(OLD, m));
    const plan = planCardChange(OLD, NEW, invoices, rows, TODAY, USER, '2026-11-05T12:00:00.000Z');
    expect(plan.count).toBe(6);
    expect(willMoveText(plan.count)).toBe('6 itens podem mudar de fatura');
    const moved = new Map(plan.transactions.map((r) => [r.id, r.invoice_id]));
    expect([...moved.keys()].sort()).toEqual(['o1', 'o2', 'o3', 'p1', 'p2', 'p3']);
    // RN-12 com F = 8: compras de 03 a 05/11 vão para a fatura que fecha em 08/11 (nov/2026)
    expect(moved.get('o1')).toBe(invoiceId(CARD_ID, '2026-11'));
    expect(moved.get('p1')).toBe(invoiceId(CARD_ID, '2026-11'));
    expect(moved.get('p2')).toBe(invoiceId(CARD_ID, '2026-12'));
    expect(moved.get('p3')).toBe(invoiceId(CARD_ID, '2027-01'));
    // a fatura fechada mantém as datas; a aberta (dez) ganha o fechamento novo; nenhuma fatura nova falta
    const byId = new Map(plan.invoices.map((r) => [r.id, r]));
    expect(byId.has(invoiceId(CARD_ID, '2026-11'))).toBe(false);
    expect(byId.get(invoiceId(CARD_ID, '2026-12'))?.closing_date).toBe('2026-12-08');
  });

  it('RN-17: só mudar o limite ou o nome não mexe em fatura nenhuma', () => {
    const rows = scenario();
    const plan = planCardChange(
      OLD,
      { ...OLD, limitCents: 500_000 },
      [],
      rows,
      TODAY,
      USER,
      '2026-11-05T12:00:00.000Z',
    );
    expect(plan).toEqual({ count: 0, invoices: [], transactions: [] });
    expect(willMoveText(0)).toBeNull();
    expect(willMoveText(1)).toBe('1 item pode mudar de fatura');
  });

  it('RN-17: datas informadas (RN-19) não são reescritas e a fatura que passa a receber item é criada', () => {
    const rows = [buy('p3', '2026-11-04', { installment_number: 3, installment_count: 3 })];
    const manual = { ...invoiceOf(OLD, '2027-02'), is_manual_dates: true };
    const plan = planCardChange(OLD, NEW, [manual], rows, TODAY, USER, '2026-11-05T12:00:00.000Z');
    expect(plan.count).toBe(1);
    expect(plan.invoices.map((r) => r.id)).toEqual([invoiceId(CARD_ID, '2027-01')]);
  });

  it('US-11: editCard grava itens, faturas e cartão; a S03 mostra a prévia antes de salvar', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem db');
    }
    await db.cards.put(cardRow());
    for (const m of ['2026-11', '2026-12', '2027-01'] as const) {
      await db.invoices.put(invoiceOf(OLD, m));
    }
    await db.transactions.bulkPut(scenario());
    const router = createMemoryRouter([{ path: '*', element: <CardsSection today={TODAY} /> }], {
      initialEntries: ['/ajustes/contas'],
    });
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const row = await screen.findByTestId(`card-${CARD_ID}`);
    // com lançamentos: Arquivar, sem Excluir
    await waitFor(() =>
      expect(within(row).queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument(),
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    const form = await screen.findByTestId(`card-edit-${CARD_ID}`);
    expect(within(form).queryByTestId('card-will-move')).not.toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Dia de fechamento'), {
      target: { value: '8' },
    });
    expect(await within(form).findByTestId('card-will-move')).toHaveTextContent(
      '6 itens podem mudar de fatura',
    );
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Fecha dia 8 · vence dia 10')).toBeInTheDocument();
    expect((await db.cards.get(CARD_ID))?.closing_day).toBe(8);
    expect((await db.transactions.get('o1'))?.invoice_id).toBe(invoiceId(CARD_ID, '2026-11'));
    expect((await db.transactions.get('c1'))?.invoice_id).toBe(invoiceId(CARD_ID, '2026-11'));
    expect((await db.transactions.get('fix'))?.invoice_id).toBe(invoiceId(CARD_ID, '2026-12'));
    expect((await db.invoices.get(invoiceId(CARD_ID, '2026-12')))?.closing_date).toBe('2026-12-08');
    expect(await db.outbox.count()).toBeGreaterThan(0);
  });

  it('US-11: editCard valida o nome e o cartão que não existe', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem db');
    }
    await db.cards.put(cardRow());
    await db.cards.put(cardRow({ id: '00000000-0000-7000-8000-0000000000cb', name: 'Nubank' }));
    const input = { name: 'nubank', closingDay: 3, dueDay: 10 };
    const clash = await editCard(db, USER, CARD_ID, input, TODAY);
    expect(clash.ok ? null : clash.error.code).toBe('CARD_NAME');
    const missing = await editCard(db, USER, 'nada', input, TODAY);
    expect(missing.ok ? null : missing.error.code).toBe('CARD_NOT_FOUND');
    const same = await editCard(db, USER, CARD_ID, { ...input, name: 'Cartão A' }, TODAY);
    expect(same).toEqual({ ok: true, value: { moved: 0 } });
  });
});

describe('US-11 arquivar e excluir', () => {
  it('US-11: cartão sem nenhum lançamento nem recorrência pode ser excluído; com uso, só arquivar', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem db');
    }
    await db.cards.put(cardRow());
    expect(await cardInUse(db, CARD_ID)).toBe(false);
    await db.recurrences.put(
      makeRow('recurrences', { id: 'r1', card_id: CARD_ID, account_id: null, deleted_at: null }),
    );
    expect(await cardInUse(db, CARD_ID)).toBe(true);
    const refused = await removeCard(db, CARD_ID);
    expect(refused.ok ? null : refused.error.code).toBe('CARD_HAS_TRANSACTIONS');
    await db.recurrences.put(
      makeRow('recurrences', { id: 'r1', card_id: CARD_ID, deleted_at: '2026-11-05T00:00:00Z' }),
    );
    await db.transactions.put(
      tx('pay', { kind: 'transfer', counterpart_card_id: CARD_ID, deleted_at: null }),
    );
    expect(await cardInUse(db, CARD_ID)).toBe(true);
  });

  it('US-11: cartão arquivado vai para "Cartões arquivados" e volta com Desarquivar', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem db');
    }
    await db.cards.put(cardRow());
    const router = createMemoryRouter([{ path: '*', element: <CardsSection today={TODAY} /> }], {
      initialEntries: ['/ajustes/contas'],
    });
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const row = await screen.findByTestId(`card-${CARD_ID}`);
    expect(await within(row).findByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Arquivar' }));
    expect(await screen.findByText('Cartões arquivados')).toBeInTheDocument();
    expect(screen.getByText('Nenhum cartão cadastrado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desarquivar' }));
    await waitFor(() => expect(screen.queryByText('Cartões arquivados')).not.toBeInTheDocument());
    // nome repetido com um ativo não desarquiva
    await db.cards.put(cardRow({ archived_at: '2026-11-05T00:00:00Z' }));
    await db.cards.put(cardRow({ id: '00000000-0000-7000-8000-0000000000cb' }));
    const clash = await unarchiveCard(db, CARD_ID);
    expect(clash.ok ? null : clash.error.code).toBe('CARD_NAME');
    expect((await unarchiveCard(db, 'nada')).ok).toBe(false);
  });

  it('US-11: conta "Carteira" arquivada some dos seletores e o lançamento antigo mostra o selo "arquivada"', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem db');
    }
    await db.accounts.put(
      makeRow('accounts', {
        id: 'carteira',
        name: 'Carteira',
        type: 'cash',
        archived_at: '2026-11-05T00:00:00Z',
        deleted_at: null,
      }),
    );
    await db.transactions.put(
      tx('antigo', { account_id: 'carteira', payment_method: 'cash', deleted_at: null }),
    );
    expect(accountLabel(await db.accounts.toArray(), 'carteira')).toBe('Carteira · arquivada');
    expect(accountLabel([], 'carteira')).toBeUndefined();
    expect(cardLabel([cardRow({ archived_at: '2026-11-05T00:00:00Z' })], CARD_ID)).toBe(
      'Cartão A · arquivado',
    );
    expect(cardLabel([cardRow()], CARD_ID)).toBe('Cartão A');
    expect(cardLabel([], CARD_ID)).toBeUndefined();
    const router = createMemoryRouter(
      [{ path: '/lancamentos/:id', element: <TransactionDetailScreen /> }],
      { initialEntries: ['/lancamentos/antigo'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Carteira · arquivada')).toBeInTheDocument();
  });

  it('US-11: conta sem uso mostra Excluir; com lançamento, recorrência ou cartão, só Arquivar; Editar renomeia', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem db');
    }
    const account = (id: string, name: string) =>
      makeRow('accounts', {
        id,
        name,
        type: 'checking',
        institution: null,
        archived_at: null,
        deleted_at: null,
      });
    await db.accounts.bulkPut([account('livre', 'Livre'), account('bb', 'BB')]);
    await db.cards.put(cardRow({ payment_account_id: 'bb' }));
    expect(await accountInUse(db, 'livre')).toBe(false);
    expect(await accountInUse(db, 'bb')).toBe(true);
    await db.recurrences.put(
      makeRow('recurrences', { id: 'r2', account_id: 'livre', card_id: null, deleted_at: null }),
    );
    expect(await accountInUse(db, 'livre')).toBe(true);
    await db.recurrences.delete('r2');
    const router = createMemoryRouter([{ path: '*', element: <AccountsScreen /> }], {
      initialEntries: ['/ajustes/contas'],
    });
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const free = await screen.findByTestId('account-livre');
    expect(await within(free).findByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    const used = screen.getByTestId('account-bb');
    expect(within(used).queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
    fireEvent.click(within(used).getByRole('button', { name: 'Editar' }));
    fireEvent.change(within(used).getByLabelText('Nome'), { target: { value: 'Livre' } });
    fireEvent.click(within(used).getByRole('button', { name: 'Salvar' }));
    expect(
      await within(screen.getByTestId('account-bb')).findByText(
        'Você já tem uma conta com esse nome',
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(screen.getByTestId('account-bb')).getByLabelText('Nome'), {
      target: { value: 'Banco do Brasil' },
    });
    fireEvent.change(within(screen.getByTestId('account-bb')).getByLabelText('Banco'), {
      target: { value: 'BB' },
    });
    fireEvent.click(
      within(screen.getByTestId('account-bb')).getByRole('button', { name: 'Salvar' }),
    );
    expect(
      await screen.findByText('Banco do Brasil', { selector: '.account-name' }),
    ).toBeInTheDocument();
    expect((await db.accounts.get('bb'))?.institution).toBe('BB');
    // cancelar a edição não grava
    fireEvent.click(
      within(screen.getByTestId('account-livre')).getByRole('button', { name: 'Editar' }),
    );
    fireEvent.click(
      within(screen.getByTestId('account-livre')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(await screen.findByText('Livre', { selector: '.account-name' })).toBeInTheDocument();
  });
});
