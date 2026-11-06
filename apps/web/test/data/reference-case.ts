// Caso de referência da RN-47 (tech §5.6; mesmo cenário da T-058) para os testes que reaproveitam o painel: hoje
// 15/11/2026, Cartão A com F=3/V=10, Disponível R$ 1.210,00 no modo caixa. Dados sintéticos.
import { invoiceForPurchase } from '@oakfinance/domain';
import type { LocalRow } from '../../src/data/db';
import { cardFromRow } from '../../src/data/mappers';
import type { HomeRows } from '../../src/features/dashboard/model';
import { buildInvoice } from '../../src/features/quick-entry/model';
import { makeRow, tx } from './rows';

export const TODAY = '2026-11-15';
export const USER = '00000000-0000-7000-8000-000000000001';
export const STAMP = '2026-11-01T12:00:00.000Z';

export function category(
  id: string,
  kind: 'income' | 'expense',
  bucket: 'needs' | 'wants' | 'savings' | 'income',
): LocalRow<'categories'> {
  return makeRow('categories', {
    id,
    slug: id,
    name: id,
    kind,
    bucket,
    parent_id: null,
    deleted_at: null,
    archived_at: null,
    is_system: false,
    feeds_reserve: bucket === 'savings',
  });
}

export const CATEGORIES = [
  category('salario', 'income', 'income'),
  category('renda-extra', 'income', 'income'),
  category('reserva-emergencia', 'expense', 'savings'),
  category('mercado', 'expense', 'needs'),
  category('moradia', 'expense', 'needs'),
  category('contas-da-casa', 'expense', 'needs'),
];

export const ACCOUNT = makeRow('accounts', {
  id: 'bb',
  name: 'Conta BB',
  type: 'checking',
  is_restricted: false,
  include_in_spendable: true,
  initial_balance_cents: 0,
  initial_balance_on: '2026-01-01',
  deleted_at: null,
  archived_at: null,
});

export const CARD = makeRow('cards', {
  id: 'a',
  name: 'Cartão A',
  closing_day: 3,
  due_day: 10,
  closing_day_rule: 'next',
  limit_cents: null,
  payment_account_id: 'bb',
  deleted_at: null,
  archived_at: null,
});

export function invoiceOf(purchase: string): LocalRow<'invoices'> {
  const period = invoiceForPurchase(cardFromRow(CARD), purchase as never);
  return { ...buildInvoice(period, USER, STAMP), is_manual_dates: false };
}

export const NOV = invoiceOf('2026-10-20');
export const DEC = invoiceOf('2026-11-15');

export function recurrence(
  id: string,
  over: Partial<LocalRow<'recurrences'>>,
): LocalRow<'recurrences'> {
  return makeRow('recurrences', {
    id,
    kind: 'expense',
    description: id,
    amount_cents: 1000,
    is_variable_amount: false,
    is_fixed_income: false,
    category_id: 'contas-da-casa',
    account_id: 'bb',
    card_id: null,
    payment_method: 'pix',
    frequency: 'monthly',
    interval_count: 1,
    day_of_month: 20,
    weekday: null,
    month_of_year: null,
    start_on: '2026-01-01',
    end_on: null,
    max_occurrences: null,
    paused_at: null,
    deleted_at: null,
    auto_post: false,
    remind: true,
    ...over,
  });
}

export const RECURRENCES = [
  recurrence('rec-salario', {
    kind: 'income',
    description: 'Salário',
    is_fixed_income: true,
    category_id: 'salario',
    amount_cents: 500000,
    day_of_month: 5,
  }),
  recurrence('rec-luz', { description: 'Luz', is_variable_amount: true, amount_cents: 18000 }),
  recurrence('rec-internet', { description: 'Internet', amount_cents: 10000, day_of_month: 25 }),
];

export const base = {
  account_id: 'bb',
  card_id: null,
  invoice_id: null,
  deleted_at: null,
  series_id: null,
  recurrence_id: null,
  recurrence_date: null,
  goal_id: null,
  income_expected: false,
  count_before_received: false,
} as const;

/** Caso de referência da RN-47 (modo caixa, hoje 15/11/2026, Cartão A F=3/V=10). */
export function referenceTxs(): LocalRow<'transactions'>[] {
  return [
    tx('salario-nov', {
      ...base,
      kind: 'income',
      category_id: 'salario',
      amount_cents: 500000,
      occurred_on: '2026-11-05',
      recurrence_id: 'rec-salario',
      recurrence_date: '2026-11-05',
      source: 'recurrence',
    }),
    tx('freela-10', {
      ...base,
      kind: 'income',
      category_id: 'renda-extra',
      amount_cents: 80000,
      occurred_on: '2026-11-10',
    }),
    tx('freela-25', {
      ...base,
      kind: 'income',
      category_id: 'renda-extra',
      amount_cents: 30000,
      occurred_on: '2026-11-25',
      income_expected: true,
    }),
    tx('reserva', {
      ...base,
      category_id: 'reserva-emergencia',
      amount_cents: 20000,
      occurred_on: '2026-11-06',
    }),
    tx('mercado', {
      ...base,
      category_id: 'mercado',
      amount_cents: 45000,
      occurred_on: '2026-11-08',
      payment_method: 'debit',
    }),
    tx('aluguel', {
      ...base,
      category_id: 'moradia',
      amount_cents: 150000,
      occurred_on: '2026-11-10',
    }),
    tx('compra-out', {
      ...base,
      account_id: null,
      card_id: 'a',
      invoice_id: NOV.id,
      payment_method: 'credit',
      category_id: 'mercado',
      amount_cents: 120000,
      occurred_on: '2026-10-20',
    }),
    tx('pagamento-nov', {
      ...base,
      kind: 'transfer',
      category_id: null,
      counterpart_card_id: 'a',
      invoice_id: NOV.id,
      amount_cents: 120000,
      occurred_on: '2026-11-10',
      payment_method: 'transfer',
    }),
  ];
}

export function rows(txRows: LocalRow<'transactions'>[], over: Partial<HomeRows> = {}): HomeRows {
  return {
    txRows,
    recurrences: RECURRENCES,
    cards: [CARD],
    accounts: [ACCOUNT],
    categories: CATEGORIES,
    invoices: [NOV, DEC],
    budgets: [],
    profile: null,
    ...over,
  };
}
