// P03 — Futuro (US-25, RN-27, RN-29): dinheiro já comprometido nos próximos 12 meses — parcelas de cartão pelo mês
// do vencimento da fatura e ocorrências projetadas das contas fixas (valor variável pelo "≈" da RN-31).
import {
  addMonths,
  clampDay,
  daysInMonth,
  type ISODate,
  monthOf,
  projectRecurrences,
  type Recurrence,
  type Tx,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';
import { approxAmount } from '../recurrences/model';

export const FUTURE_MONTHS = 12;

export interface FutureItem {
  key: string;
  kind: 'installment' | 'fixed';
  description: string;
  amountCents: number;
  /** "4/10" na parcela; dia na conta fixa. */
  detail: string;
  /** Lançamento (parcela) para abrir a T02. */
  txId: string | null;
  cardId: string | null;
}

export interface FutureMonth {
  month: YearMonth;
  installmentsCents: number;
  fixedCents: number;
  totalCents: number;
  items: FutureItem[];
}

export function futureMonths(input: {
  today: ISODate;
  txRows: readonly LocalRow<'transactions'>[];
  invoices: readonly LocalRow<'invoices'>[];
  recurrences: readonly Recurrence[];
  txs: readonly Tx[];
}): FutureMonth[] {
  const start = addMonths(monthOf(input.today), 1);
  const end = addMonths(start, FUTURE_MONTHS - 1);
  const months = new Map<YearMonth, FutureMonth>();
  for (let i = 0; i < FUTURE_MONTHS; i += 1) {
    const month = addMonths(start, i);
    months.set(month, { month, installmentsCents: 0, fixedCents: 0, totalCents: 0, items: [] });
  }
  const dueMonth = new Map(
    input.invoices.map((r) => [r.id, r.reference_month.slice(0, 7) as YearMonth]),
  );
  for (const row of input.txRows) {
    if (
      row.series_id === null ||
      row.deleted_at !== null ||
      row.status === 'cancelled' ||
      row.kind !== 'expense'
    ) {
      continue;
    }
    const month = row.invoice_id
      ? dueMonth.get(row.invoice_id)
      : (row.occurred_on.slice(0, 7) as YearMonth);
    const slot = month ? months.get(month) : undefined;
    if (!slot) {
      continue;
    }
    slot.installmentsCents += row.amount_cents;
    slot.items.push({
      key: row.id,
      kind: 'installment',
      description: row.description ?? '',
      amountCents: row.amount_cents,
      detail: `${row.installment_number}/${row.installment_count}`,
      txId: row.id,
      cardId: row.card_id,
    });
  }
  const expenses = input.recurrences.filter((r) => r.kind === 'expense');
  const range = { from: clampDay(start, 1), to: clampDay(end, daysInMonth(end)) };
  for (const occ of projectRecurrences(expenses, range, input.txs, [])) {
    const slot = months.get(monthOf(occ.date));
    const rec = expenses.find((r) => r.id === occ.recurrenceId);
    if (!slot || !rec || occ.realizedTxId !== null) {
      continue;
    }
    const amount = rec.isVariableAmount ? approxAmount(rec, input.txs) : occ.amountCents;
    slot.fixedCents += amount;
    slot.items.push({
      key: `${rec.id}:${occ.date}`,
      kind: 'fixed',
      description: rec.description,
      amountCents: amount,
      detail: String(Number(occ.date.slice(8, 10))),
      txId: null,
      cardId: rec.cardId,
    });
  }
  return [...months.values()].map((m) => ({
    ...m,
    totalCents: m.installmentsCents + m.fixedCents,
  }));
}

/** "Comprometido nos próximos 3 meses". */
export function committedNext(months: readonly FutureMonth[], n = 3): number {
  return months.slice(0, n).reduce((sum, m) => sum + m.totalCents, 0);
}
