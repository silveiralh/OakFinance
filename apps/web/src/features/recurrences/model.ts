// Receita fixa (US-23, RN-26..RN-28, RN-32, RN-34, RN-38): a recorrência é projetada até M+12 (RN-27) e cada
// ocorrência vira lançamento com id v5 (recorrência, data) ao confirmar (valor real) ou "Não recebi este mês"
// (cancelada, sai da Base). Dois aparelhos que confirmam a mesma ocorrência gravam a mesma linha (RN-97 decide).
import {
  clampDay,
  type ISODate,
  materializeOccurrence,
  monthOf,
  type ProjectedOccurrence,
  projectionEnd,
  projectRecurrences,
  type Recurrence,
  type Tx,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { newId } from '../../data/ids';
import { txToRow } from '../../data/mappers';
import { saveRow } from '../../data/repositories/rows';

type RecurrenceRow = LocalRow<'recurrences'>;
type TxRow = LocalRow<'transactions'>;

const FREQUENCIES = ['monthly', 'weekly', 'yearly'] as const;
const METHODS = [
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
] as const;

/** Linha → domínio. Linha fora do contrato devolve `null` (fica fora da projeção). */
export function recurrenceFromRow(row: RecurrenceRow): Recurrence | null {
  const frequency = FREQUENCIES.find((f) => f === row.frequency);
  const method = METHODS.find((m) => m === row.payment_method);
  if (!frequency || !method || (row.kind !== 'income' && row.kind !== 'expense')) {
    return null;
  }
  return {
    id: row.id,
    kind: row.kind,
    description: row.description,
    amountCents: row.amount_cents,
    isVariableAmount: row.is_variable_amount,
    categoryId: row.category_id,
    accountId: row.account_id,
    cardId: row.card_id,
    paymentMethod: method,
    isFixedIncome: row.is_fixed_income,
    autoPost: row.auto_post,
    remind: row.remind,
    pausedAt: row.paused_at,
    deletedAt: row.deleted_at,
    frequency,
    intervalCount: row.interval_count,
    ...(row.day_of_month !== null ? { dayOfMonth: row.day_of_month } : {}),
    ...(row.weekday !== null ? { weekday: row.weekday } : {}),
    ...(row.month_of_year !== null ? { monthOfYear: row.month_of_year } : {}),
    startOn: row.start_on as ISODate,
    endOn: row.end_on as ISODate | null,
    maxOccurrences: row.max_occurrences,
  };
}

export interface FixedIncomeInput {
  userId: string;
  description: string;
  amountCents: number;
  /** Dia do mês (1–31, RN-03: meses curtos usam o último dia). */
  dayOfMonth: number;
  accountId: string;
  categoryId: string | null;
  /** Primeira ocorrência possível. */
  startOn: ISODate;
  nowIso: string;
  id?: string;
}

/** Receita fixa mensal (RN-26/RN-32): confirmação automática desligada para receitas. */
export function buildFixedIncome(input: FixedIncomeInput): RecurrenceRow {
  return {
    id: input.id ?? newId(),
    user_id: input.userId,
    kind: 'income',
    description: input.description.trim(),
    amount_cents: input.amountCents,
    is_variable_amount: false,
    category_id: input.categoryId,
    account_id: input.accountId,
    card_id: null,
    payment_method: 'transfer',
    is_fixed_income: true,
    auto_post: false,
    remind: true,
    paused_at: null,
    frequency: 'monthly',
    interval_count: 1,
    day_of_month: input.dayOfMonth,
    weekday: null,
    month_of_year: null,
    start_on: input.startOn,
    end_on: null,
    max_occurrences: null,
    match_pattern: null,
    created_at: input.nowIso,
    updated_at: input.nowIso,
    client_updated_at: input.nowIso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
}

/** RN-27: ocorrências de hoje (desde o início do mês) até o fim de M+12, realizadas ou não. */
export function projectIncome(
  recs: readonly Recurrence[],
  txs: readonly Tx[],
  today: ISODate,
): ProjectedOccurrence[] {
  return projectRecurrences(
    recs,
    { from: clampDay(monthOf(today), 1), to: projectionEnd(today) },
    txs,
    [],
  );
}

function blankTx(id: string, userId: string, nowIso: string): TxRow {
  return {
    id,
    user_id: userId,
    kind: 'income',
    status: 'posted',
    amount_cents: 1,
    occurred_on: nowIso.slice(0, 10),
    occurred_at: null,
    description: null,
    description_raw: null,
    notes: null,
    category_id: null,
    category_source: 'default',
    category_rule_id: null,
    payment_method: 'transfer',
    account_id: null,
    card_id: null,
    invoice_id: null,
    invoice_pinned: false,
    counterpart_account_id: null,
    counterpart_card_id: null,
    series_id: null,
    installment_number: null,
    installment_count: null,
    recurrence_id: null,
    recurrence_date: null,
    goal_id: null,
    income_expected: false,
    count_before_received: false,
    source: 'recurrence',
    external_id: null,
    external_meta: null,
    import_id: null,
    review_state: 'ok',
    duplicate_of: null,
    matched_external: false,
    merchant_name: null,
    merchant_cnpj: null,
    nfce_receipt_id: null,
    tags: [],
    created_at: nowIso,
    updated_at: nowIso,
    client_updated_at: nowIso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
}

/**
 * Lançamento da ocorrência (id v5): confirmada com o valor real (efetivada) ou "Não recebi este mês" (cancelada).
 * Se a linha já existe (outro aparelho, edição), a mesma linha é atualizada.
 */
export function occurrenceRow(
  rec: Recurrence,
  date: ISODate,
  outcome: { status: 'posted'; amountCents: number } | { status: 'cancelled' },
  existing: TxRow | undefined,
  userId: string,
  nowIso: string,
): TxRow {
  const tx = materializeOccurrence(
    rec,
    date,
    null,
    [],
    outcome.status === 'posted' ? outcome.amountCents : rec.amountCents,
  );
  return {
    ...txToRow({ ...tx, deletedAt: null }, existing ?? blankTx(tx.id, userId, nowIso)),
    status: outcome.status,
    category_source: rec.categoryId ? 'default' : 'none',
  };
}

export async function confirmOccurrence(
  db: OakDb,
  userId: string,
  rec: Recurrence,
  date: ISODate,
  amountCents: number,
  nowMs: number = Date.now(),
) {
  const id = materializeOccurrence(rec, date, null).id;
  const existing = await db.transactions.get(id);
  return saveRow(
    db,
    'transactions',
    occurrenceRow(
      rec,
      date,
      { status: 'posted', amountCents },
      existing,
      userId,
      new Date(nowMs).toISOString(),
    ),
    { nowMs },
  );
}

export async function skipOccurrence(
  db: OakDb,
  userId: string,
  rec: Recurrence,
  date: ISODate,
  nowMs: number = Date.now(),
) {
  const id = materializeOccurrence(rec, date, null).id;
  const existing = await db.transactions.get(id);
  return saveRow(
    db,
    'transactions',
    occurrenceRow(
      rec,
      date,
      { status: 'cancelled' },
      existing,
      userId,
      new Date(nowMs).toISOString(),
    ),
    { nowMs },
  );
}
