// Recorrências: contas fixas, assinaturas e salário (tech §5.4, PRD RN-26..RN-30, ADR-08).
// Ocorrências são projetadas (sem linha no banco) até o fim de M+12 e viram lançamento com id v5 ao materializar.
import {
  addDays,
  addMonths,
  clampDay,
  daysInMonth,
  monthOf,
  parseISODate,
  toYearMonth,
  weekday,
} from './dates.ts';
import { DomainError } from './errors.ts';
import { recurrenceTxId } from './ids.ts';
import { type InvoiceDates, invoiceForPurchase } from './invoices.ts';
import type { Card, Cents, ISODate, PaymentMethod, Tx, YearMonth } from './types.ts';

export interface RecurrenceRule {
  frequency: 'monthly' | 'weekly' | 'yearly';
  intervalCount: number;
  dayOfMonth?: number;
  weekday?: number;
  monthOfYear?: number;
  startOn: ISODate;
  endOn?: ISODate | null;
  maxOccurrences?: number | null;
}

export interface Recurrence extends RecurrenceRule {
  id: string;
  kind: 'expense' | 'income';
  description: string;
  amountCents: Cents;
  isVariableAmount: boolean;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  paymentMethod: PaymentMethod;
  isFixedIncome: boolean;
  autoPost: boolean;
  remind: boolean;
  pausedAt: string | null;
  deletedAt: string | null;
}

export interface ProjectedOccurrence {
  recurrenceId: string;
  date: ISODate;
  amountCents: Cents;
  kind: 'expense' | 'income';
  realizedTxId: string | null;
  invoiceReferenceMonth: YearMonth | null;
}

/** RN-27: as ocorrências são projetadas até o último dia de M+12. */
export function projectionEnd(today: ISODate): ISODate {
  const m = addMonths(monthOf(today), 12);
  return clampDay(m, daysInMonth(m));
}

function* candidates(rule: RecurrenceRule): Generator<ISODate> {
  const step = rule.intervalCount;
  if (!Number.isInteger(step) || step < 1) {
    throw new DomainError('INVALID_ARGUMENT', `intervalo inválido: ${step}`);
  }
  const start = parseISODate(rule.startOn);
  if (rule.frequency === 'weekly') {
    if (rule.weekday === undefined) {
      throw new DomainError('INVALID_ARGUMENT', 'recorrência semanal sem dia da semana');
    }
    const offset = (((rule.weekday - weekday(rule.startOn)) % 7) + 7) % 7;
    for (let d = addDays(rule.startOn, offset); ; d = addDays(d, 7 * step)) {
      yield d;
    }
  }
  if (rule.dayOfMonth === undefined) {
    throw new DomainError('INVALID_ARGUMENT', 'recorrência sem dia do mês');
  }
  const day = rule.dayOfMonth;
  if (rule.frequency === 'monthly') {
    for (let m = toYearMonth(start.year, start.month); ; m = addMonths(m, step)) {
      yield clampDay(m, day); // RN-03: dia 31 em mês de 30 → último dia
    }
  }
  if (rule.monthOfYear === undefined) {
    throw new DomainError('INVALID_ARGUMENT', 'recorrência anual sem mês');
  }
  for (let y = start.year; ; y += step) {
    yield clampDay(toYearMonth(y, rule.monthOfYear), day); // 29/02 → 28/02 nos anos não bissextos
  }
}

/** Datas da regra dentro de [from, to]. maxOccurrences conta desde startOn, não desde from. */
export function occurrences(
  rule: RecurrenceRule,
  range: { from: ISODate; to: ISODate },
): ISODate[] {
  const out: ISODate[] = [];
  let count = 0;
  for (const date of candidates(rule)) {
    if (date < rule.startOn) {
      continue;
    }
    if (date > range.to || (rule.endOn && date > rule.endOn)) {
      break;
    }
    count += 1;
    if (rule.maxOccurrences && count > rule.maxOccurrences) {
      break;
    }
    if (date >= range.from) {
      out.push(date);
    }
  }
  return out;
}

function realizedTx(rec: Recurrence, date: ISODate, txs: readonly Tx[]): Tx | undefined {
  return txs.find(
    (t) => t.recurrenceId === rec.id && t.recurrenceDate === date && t.deletedAt === null,
  );
}

function active(rec: Recurrence): boolean {
  return rec.pausedAt === null && rec.deletedAt === null;
}

/** Projeção das ocorrências (RN-27); realizada = existe lançamento com recurrenceId + recurrenceDate. */
export function projectRecurrences(
  recs: readonly Recurrence[],
  range: { from: ISODate; to: ISODate },
  txs: readonly Tx[],
  cards: readonly Card[],
): ProjectedOccurrence[] {
  const out: ProjectedOccurrence[] = [];
  for (const rec of recs) {
    if (!active(rec)) {
      continue;
    }
    const card = rec.cardId ? cards.find((c) => c.id === rec.cardId) : undefined;
    for (const date of occurrences(rec, range)) {
      const realized = realizedTx(rec, date, txs);
      out.push({
        recurrenceId: rec.id,
        date,
        amountCents: realized?.amountCents ?? rec.amountCents,
        kind: rec.kind,
        realizedTxId: realized?.id ?? null,
        invoiceReferenceMonth: card ? invoiceForPurchase(card, date).referenceMonth : null, // RN-29
      });
    }
  }
  return out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.recurrenceId < b.recurrenceId ? -1 : 1,
  );
}

/** Lançamento da ocorrência (RN-27/RN-29): id v5 idempotente; no cartão, vai para a fatura da data (RN-12). */
export function materializeOccurrence(
  rec: Recurrence,
  date: ISODate,
  card: Card | null,
  overrides: readonly InvoiceDates[] = [],
  amountCents?: Cents,
): Omit<Tx, 'deletedAt'> {
  let invoiceId: string | null = null;
  if (rec.cardId !== null) {
    if (!card || card.id !== rec.cardId) {
      throw new DomainError('INVALID_ARGUMENT', 'cartão da recorrência ausente');
    }
    invoiceId = invoiceForPurchase(card, date, overrides).id;
  }
  return {
    id: recurrenceTxId(rec.id, date),
    kind: rec.kind,
    status: 'posted',
    countBeforeReceived: false,
    invoicePinned: false,
    amountCents: amountCents ?? rec.amountCents,
    occurredOn: date,
    description: rec.description,
    categoryId: rec.categoryId,
    paymentMethod: rec.paymentMethod,
    accountId: rec.accountId,
    cardId: rec.cardId,
    invoiceId,
    counterpartAccountId: null,
    counterpartCardId: null,
    seriesId: null,
    installmentNumber: null,
    installmentCount: null,
    recurrenceId: rec.id,
    recurrenceDate: date,
    goalId: null,
    incomeExpected: false,
    source: 'recurrence',
    externalId: null,
    reviewState: 'ok',
    duplicateOf: null,
    merchantCnpj: null,
  };
}

/** RN-28: ocorrências com confirmação automática vencidas (até hoje, olhando `lookbackDays` para trás) e não realizadas. */
export function dueAutoPosts(
  recs: readonly Recurrence[],
  txs: readonly Tx[],
  today: ISODate,
  lookbackDays = 31,
): Array<{ recurrenceId: string; date: ISODate }> {
  const out: Array<{ recurrenceId: string; date: ISODate }> = [];
  for (const rec of recs) {
    if (!rec.autoPost || !active(rec)) {
      continue;
    }
    for (const date of occurrences(rec, { from: addDays(today, -lookbackDays), to: today })) {
      if (!realizedTx(rec, date, txs)) {
        out.push({ recurrenceId: rec.id, date });
      }
    }
  }
  return out;
}
