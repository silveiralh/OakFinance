// Receita fixa (US-23, RN-26..RN-28, RN-32, RN-34, RN-38): a recorrência é projetada até M+12 (RN-27) e cada
// ocorrência vira lançamento com id v5 (recorrência, data) ao confirmar (valor real) ou "Não recebi este mês"
// (cancelada, sai da Base). Dois aparelhos que confirmam a mesma ocorrência gravam a mesma linha (RN-97 decide).
import {
  type Card,
  clampDay,
  dueAutoPosts,
  type ISODate,
  invoiceForPurchase,
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
import { cardFromRow, txToRow } from '../../data/mappers';
import { saveRow } from '../../data/repositories/rows';
import { buildInvoice } from '../quick-entry/model';

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
 * Lançamento da ocorrência (id v5): confirmada com o valor real (efetivada) ou "Não recebi/Pular este mês" (cancelada).
 * No cartão, vai para a fatura da data (RN-29). Se a linha já existe (outro aparelho, edição), ela é atualizada.
 */
export function occurrenceRow(
  rec: Recurrence,
  date: ISODate,
  outcome: { status: 'posted'; amountCents: number } | { status: 'cancelled' },
  existing: TxRow | undefined,
  userId: string,
  nowIso: string,
  card: Card | null = null,
): TxRow {
  const tx = materializeOccurrence(
    rec,
    date,
    card,
    [],
    outcome.status === 'posted' ? outcome.amountCents : rec.amountCents,
  );
  return {
    ...txToRow({ ...tx, deletedAt: null }, existing ?? blankTx(tx.id, userId, nowIso)),
    status: outcome.status,
    category_source: rec.categoryId ? 'default' : 'none',
  };
}

/** Grava a ocorrência (e a fatura do cartão, se faltar) com o resultado escolhido. */
async function writeOccurrence(
  db: OakDb,
  userId: string,
  rec: Recurrence,
  date: ISODate,
  outcome: { status: 'posted'; amountCents: number } | { status: 'cancelled' },
  nowMs: number,
) {
  const cardRow = rec.cardId ? await db.cards.get(rec.cardId) : undefined;
  const card = cardRow ? cardFromRow(cardRow) : null;
  const nowIso = new Date(nowMs).toISOString();
  if (card) {
    const period = invoiceForPurchase(card, date);
    if (!(await db.invoices.get(period.id))) {
      await saveRow(db, 'invoices', buildInvoice(period, userId, nowIso), { nowMs });
    }
  }
  const id = materializeOccurrence(rec, date, card).id;
  const existing = await db.transactions.get(id);
  return saveRow(
    db,
    'transactions',
    occurrenceRow(rec, date, outcome, existing, userId, nowIso, card),
    { nowMs },
  );
}

export function confirmOccurrence(
  db: OakDb,
  userId: string,
  rec: Recurrence,
  date: ISODate,
  amountCents: number,
  nowMs: number = Date.now(),
) {
  return writeOccurrence(db, userId, rec, date, { status: 'posted', amountCents }, nowMs);
}

export function skipOccurrence(
  db: OakDb,
  userId: string,
  rec: Recurrence,
  date: ISODate,
  nowMs: number = Date.now(),
) {
  return writeOccurrence(db, userId, rec, date, { status: 'cancelled' }, nowMs);
}

/** RN-31: "≈ R$ X", com X = valor da última ocorrência efetivada (ou o cadastrado). */
export function approxAmount(rec: Recurrence, txs: readonly Tx[]): number {
  const last = txs
    .filter(
      (t) =>
        t.recurrenceId === rec.id &&
        t.deletedAt === null &&
        t.status === 'posted' &&
        t.recurrenceDate !== null,
    )
    .sort((a, b) => ((a.recurrenceDate ?? '') < (b.recurrenceDate ?? '') ? 1 : -1))[0];
  return last?.amountCents ?? rec.amountCents;
}

export interface FixedExpenseInput {
  userId: string;
  description: string;
  amountCents: number;
  dayOfMonth: number;
  /** Conta (Pix) ou cartão (crédito): só um. */
  accountId: string | null;
  cardId: string | null;
  categoryId: string | null;
  variable: boolean;
  /** RN-26: padrão ligado no cartão (assinaturas) e desligado nos meios imediatos. */
  autoPost?: boolean;
  startOn: ISODate;
  nowIso: string;
  id?: string;
}

/** Conta fixa ou assinatura mensal (RN-26). */
export function buildFixedExpense(input: FixedExpenseInput): RecurrenceRow {
  return {
    ...buildFixedIncome({
      userId: input.userId,
      description: input.description,
      amountCents: input.amountCents,
      dayOfMonth: input.dayOfMonth,
      accountId: input.accountId ?? '',
      categoryId: input.categoryId,
      startOn: input.startOn,
      nowIso: input.nowIso,
      ...(input.id ? { id: input.id } : {}),
    }),
    kind: 'expense',
    is_fixed_income: false,
    account_id: input.accountId,
    card_id: input.cardId,
    payment_method: input.cardId ? 'credit' : 'pix',
    is_variable_amount: input.variable,
    auto_post: input.autoPost ?? input.cardId !== null,
  };
}

/** RN-28: ocorrências com confirmação automática vencidas e ainda sem lançamento. */
export async function runAutoPosts(
  db: OakDb,
  userId: string,
  recs: readonly Recurrence[],
  txs: readonly Tx[],
  today: ISODate,
  nowMs: number = Date.now(),
): Promise<number> {
  let n = 0;
  for (const due of dueAutoPosts(recs, txs, today)) {
    const rec = recs.find((r) => r.id === due.recurrenceId);
    if (rec) {
      const result = await confirmOccurrence(
        db,
        userId,
        rec,
        due.date,
        approxAmount(rec, txs),
        nowMs,
      );
      n += result.ok ? 1 : 0;
    }
  }
  return n;
}
