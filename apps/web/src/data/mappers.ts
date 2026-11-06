// Única fronteira entre as linhas do banco (snake_case, iguais ao Postgres) e os tipos do domínio (camelCase),
// tech §2.3. Linhas que chegam do servidor passam pelo zod de `schemas.ts`; valores fora dos `check` do banco viram
// `MapperError` (bug ou dado corrompido, nunca ignorado em silêncio).
import type {
  Account,
  Card,
  Category,
  CategoryBucket,
  PaymentMethod,
  ReviewState,
  Tx,
  TxKind,
  TxSource,
} from '@oakfinance/domain';
import type { z } from 'zod';
import type { LocalRow, SyncedTable } from './db';
import { rowSchemas } from './schemas';

export class MapperError extends Error {
  override name = 'MapperError';
}

export const TX_KINDS = [
  'expense',
  'income',
  'transfer',
  'refund',
  'adjust_in',
  'adjust_out',
] as const satisfies readonly TxKind[];
export const TX_STATUSES = [
  'posted',
  'pending',
  'cancelled',
] as const satisfies readonly Tx['status'][];
export const PAYMENT_METHODS = [
  'pix',
  'debit',
  'credit',
  'cash',
  'meal_voucher',
  'food_voucher',
  'transfer',
  'boleto',
  'auto_debit',
  'other',
] as const satisfies readonly PaymentMethod[];
export const TX_SOURCES = [
  'manual',
  'pluggy',
  'ofx',
  'csv',
  'nfce',
  'recurrence',
  'installment',
  'system',
] as const satisfies readonly TxSource[];
export const REVIEW_STATES = [
  'ok',
  'new',
  'suggested',
  'merged',
  'ignored',
] as const satisfies readonly ReviewState[];
export const CLOSING_DAY_RULES = [
  'next',
  'same',
] as const satisfies readonly Card['closingDayRule'][];
export const CATEGORY_KINDS = [
  'expense',
  'income',
  'transfer',
] as const satisfies readonly Category['kind'][];
export const CATEGORY_BUCKETS = [
  'needs',
  'wants',
  'savings',
  'income',
  'transfer',
  'none',
] as const satisfies readonly CategoryBucket[];

function oneOf<T extends string>(allowed: readonly T[], value: string, column: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new MapperError(`valor inválido em ${column}: ${value}`);
}

/**
 * Valida uma linha vinda do servidor (`sync_pull`) ou de um backup. Campos locais (`_pending`) e colunas que o
 * app ainda não conhece são descartados.
 */
export function parseRow<T extends SyncedTable>(table: T, value: unknown): LocalRow<T> {
  const schema: z.ZodType = rowSchemas[table];
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const columns = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new MapperError(`linha inválida em ${table}: ${columns}`);
  }
  return parsed.data as LocalRow<T>;
}

/** Linha para a outbox: sem os campos locais (`_…`), que nunca vão para o servidor. */
export function toServerRow<T extends SyncedTable>(row: LocalRow<T>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith('_')) {
      out[key] = value;
    }
  }
  return out;
}

export function txFromRow(row: LocalRow<'transactions'>): Tx {
  return {
    id: row.id,
    kind: oneOf(TX_KINDS, row.kind, 'transactions.kind'),
    status: oneOf(TX_STATUSES, row.status, 'transactions.status'),
    countBeforeReceived: row.count_before_received,
    invoicePinned: row.invoice_pinned,
    amountCents: row.amount_cents,
    occurredOn: row.occurred_on,
    description: row.description,
    categoryId: row.category_id,
    paymentMethod: oneOf(PAYMENT_METHODS, row.payment_method, 'transactions.payment_method'),
    accountId: row.account_id,
    cardId: row.card_id,
    invoiceId: row.invoice_id,
    counterpartAccountId: row.counterpart_account_id,
    counterpartCardId: row.counterpart_card_id,
    seriesId: row.series_id,
    installmentNumber: row.installment_number,
    installmentCount: row.installment_count,
    recurrenceId: row.recurrence_id,
    recurrenceDate: row.recurrence_date,
    goalId: row.goal_id,
    incomeExpected: row.income_expected,
    source: oneOf(TX_SOURCES, row.source, 'transactions.source'),
    externalId: row.external_id,
    reviewState: oneOf(REVIEW_STATES, row.review_state, 'transactions.review_state'),
    duplicateOf: row.duplicate_of,
    merchantCnpj: row.merchant_cnpj,
    deletedAt: row.deleted_at,
  };
}

/** Aplica os campos do domínio sobre a linha existente (as colunas que o domínio não conhece ficam). */
export function txToRow(tx: Tx, base: LocalRow<'transactions'>): LocalRow<'transactions'> {
  return {
    ...base,
    id: tx.id,
    kind: tx.kind,
    status: tx.status,
    count_before_received: tx.countBeforeReceived,
    invoice_pinned: tx.invoicePinned,
    amount_cents: tx.amountCents,
    occurred_on: tx.occurredOn,
    description: tx.description,
    category_id: tx.categoryId,
    payment_method: tx.paymentMethod,
    account_id: tx.accountId,
    card_id: tx.cardId,
    invoice_id: tx.invoiceId,
    counterpart_account_id: tx.counterpartAccountId,
    counterpart_card_id: tx.counterpartCardId,
    series_id: tx.seriesId,
    installment_number: tx.installmentNumber,
    installment_count: tx.installmentCount,
    recurrence_id: tx.recurrenceId,
    recurrence_date: tx.recurrenceDate,
    goal_id: tx.goalId,
    income_expected: tx.incomeExpected,
    source: tx.source,
    external_id: tx.externalId,
    review_state: tx.reviewState,
    duplicate_of: tx.duplicateOf,
    merchant_cnpj: tx.merchantCnpj,
    deleted_at: tx.deletedAt,
  };
}

export function cardFromRow(row: LocalRow<'cards'>): Card {
  return {
    id: row.id,
    closingDay: row.closing_day,
    dueDay: row.due_day,
    closingDayRule: oneOf(CLOSING_DAY_RULES, row.closing_day_rule, 'cards.closing_day_rule'),
    limitCents: row.limit_cents,
    paymentAccountId: row.payment_account_id,
  };
}

export function cardToRow(card: Card, base: LocalRow<'cards'>): LocalRow<'cards'> {
  return {
    ...base,
    id: card.id,
    closing_day: card.closingDay,
    due_day: card.dueDay,
    closing_day_rule: card.closingDayRule,
    limit_cents: card.limitCents,
    payment_account_id: card.paymentAccountId,
  };
}

export function accountFromRow(row: LocalRow<'accounts'>): Account {
  return {
    id: row.id,
    type: row.type,
    isRestricted: row.is_restricted,
    includeInSpendable: row.include_in_spendable,
    initialBalanceCents: row.initial_balance_cents,
    initialBalanceOn: row.initial_balance_on,
  };
}

export function accountToRow(account: Account, base: LocalRow<'accounts'>): LocalRow<'accounts'> {
  return {
    ...base,
    id: account.id,
    type: account.type,
    is_restricted: account.isRestricted,
    include_in_spendable: account.includeInSpendable,
    initial_balance_cents: account.initialBalanceCents,
    initial_balance_on: account.initialBalanceOn,
  };
}

export function categoryFromRow(row: LocalRow<'categories'>): Category {
  return {
    id: row.id,
    parentId: row.parent_id,
    kind: oneOf(CATEGORY_KINDS, row.kind, 'categories.kind'),
    bucket: oneOf(CATEGORY_BUCKETS, row.bucket, 'categories.bucket'),
    slug: row.slug,
    feedsReserve: row.feeds_reserve,
    isSystem: row.is_system,
  };
}

export function categoryToRow(
  category: Category,
  base: LocalRow<'categories'>,
): LocalRow<'categories'> {
  return {
    ...base,
    id: category.id,
    parent_id: category.parentId,
    kind: category.kind,
    bucket: category.bucket,
    slug: category.slug,
    feeds_reserve: category.feedsReserve,
    is_system: category.isSystem,
  };
}
