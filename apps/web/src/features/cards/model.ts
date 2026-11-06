// Cartões e faturas (C01/C02, US-17, US-18, RN-10..RN-15, RN-18): visão de cada fatura pelo domínio, faturas que
// faltam (id v5) e o "Saldo credor da fatura anterior" (RN-15) para gravar, e o "Mover para outra fatura" (RN-18).
import {
  addMonths,
  type Card,
  cardAvailableLimit,
  carryOverCredit,
  currentOpenInvoice,
  ensureInvoices,
  type InvoiceDates,
  type InvoicePeriod,
  type InvoiceStatus,
  type InvoiceTotals,
  type ISODate,
  invoicePeriod,
  invoiceStatus,
  invoiceTotals,
  type Tx,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';
import { txToRow } from '../../data/mappers';
import { buildInvoice } from '../quick-entry/model';

type InvoiceRow = LocalRow<'invoices'>;
type TxRow = LocalRow<'transactions'>;

/** Quantas faturas futuras a C01 mostra (UX §3 C01). */
export const UPCOMING = 3;
/** Quantas faturas anteriores a C01 mostra. */
export const PREVIOUS = 3;

/** Datas informadas (manuais ou do banco) substituem as calculadas (RN-19). */
export function overridesOf(rows: readonly InvoiceRow[]): InvoiceDates[] {
  return rows
    .filter((r) => r.deleted_at === null && r.is_manual_dates)
    .map((r) => ({
      referenceMonth: r.reference_month.slice(0, 7) as YearMonth,
      closingDate: r.closing_date as ISODate,
      dueDate: r.due_date as ISODate,
    }));
}

/** Dias corridos de `from` até `to` (negativo se `to` já passou). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export interface InvoiceView {
  period: InvoicePeriod;
  totals: InvoiceTotals;
  status: InvoiceStatus;
  /** Compras − estornos (pode ser < 0: saldo credor). */
  totalCents: number;
  /** O que falta pagar (`balanceCents` ≥ 0). */
  remainingCents: number;
  daysToDue: number;
  daysToClose: number;
  /** Itens da fatura (compras, estornos e pagamentos), do mais recente para o mais antigo. */
  items: Tx[];
}

export function invoiceView(
  card: Card,
  month: YearMonth,
  txs: readonly Tx[],
  overrides: readonly InvoiceDates[],
  today: ISODate,
): InvoiceView {
  const period = invoicePeriod(card, month, overrides);
  const totals = invoiceTotals(period.id, txs);
  const items = txs
    .filter((tx) => tx.invoiceId === period.id && tx.deletedAt === null)
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0));
  return {
    period,
    totals,
    status: invoiceStatus(period, totals, today),
    totalCents: totals.chargesCents - totals.creditsCents,
    remainingCents: Math.max(0, totals.balanceCents),
    daysToDue: daysBetween(today, period.dueDate),
    daysToClose: daysBetween(today, period.closingDate),
    items,
  };
}

export interface CardOverview {
  current: InvoiceView;
  upcoming: InvoiceView[];
  previous: InvoiceView[];
  limitCents: number | null;
  usedCents: number | null;
}

/** C01: a fatura atual (a que recebe as compras de hoje), as 3 seguintes e as 3 anteriores com itens ou registro. */
export function cardOverview(
  card: Card,
  txs: readonly Tx[],
  invoiceRows: readonly InvoiceRow[],
  today: ISODate,
): CardOverview {
  const overrides = overridesOf(invoiceRows);
  const month = currentOpenInvoice(card, today, overrides).referenceMonth;
  const known = new Set(
    invoiceRows
      .filter((r) => r.deleted_at === null && r.card_id === card.id)
      .map((r) => r.reference_month.slice(0, 7)),
  );
  const previous: InvoiceView[] = [];
  for (let i = 1; i <= 24 && previous.length < PREVIOUS; i += 1) {
    const m = addMonths(month, -i);
    if (known.has(m)) {
      previous.push(invoiceView(card, m, txs, overrides, today));
    }
  }
  const available = cardAvailableLimit(card, txs);
  return {
    current: invoiceView(card, month, txs, overrides, today),
    upcoming: Array.from({ length: UPCOMING }, (_, i) =>
      invoiceView(card, addMonths(month, i + 1), txs, overrides, today),
    ),
    previous,
    limitCents: card.limitCents,
    usedCents: card.limitCents === null || available === null ? null : card.limitCents - available,
  };
}

/** Linha vazia de `transactions` para um lançamento que o app gera (saldo credor). */
function blankTx(id: string, userId: string, nowIso: string): TxRow {
  return {
    id,
    user_id: userId,
    kind: 'refund',
    status: 'posted',
    amount_cents: 0,
    occurred_on: nowIso.slice(0, 10),
    occurred_at: null,
    description: null,
    description_raw: null,
    notes: null,
    category_id: null,
    category_source: 'default',
    category_rule_id: null,
    payment_method: 'credit',
    account_id: null,
    card_id: null,
    invoice_id: null,
    invoice_pinned: true,
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
    source: 'system',
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

export interface CardDataPlan {
  invoices: InvoiceRow[];
  transactions: TxRow[];
}

/**
 * O que gravar para o cartão: as faturas que faltam da atual até +3 (id v5, iguais em qualquer aparelho) e o saldo
 * credor da RN-15 de cada fatura fechada com total negativo, na fatura seguinte (id v5; só grava se mudou).
 */
export function planCardData(
  card: Card,
  invoiceRows: readonly InvoiceRow[],
  txRows: readonly TxRow[],
  txs: readonly Tx[],
  today: ISODate,
  userId: string,
  nowIso: string,
  carryOverCategoryId: string | null,
): CardDataPlan {
  const own = invoiceRows.filter((r) => r.card_id === card.id && r.deleted_at === null);
  const overrides = overridesOf(own);
  const existing = own.map((r) => ({
    referenceMonth: r.reference_month.slice(0, 7) as YearMonth,
    closingDate: r.closing_date as ISODate,
    dueDate: r.due_date as ISODate,
  }));
  const month = currentOpenInvoice(card, today, overrides).referenceMonth;
  const missing = ensureInvoices(card, month, addMonths(month, UPCOMING), existing);
  const have = new Set(existing.map((e) => e.referenceMonth));
  const invoices = missing.map((p) => buildInvoice(p, userId, nowIso));
  const transactions: TxRow[] = [];
  const byId = new Map(txRows.map((r) => [r.id, r]));
  const months = [...have].sort();
  for (const m of months) {
    const prev = invoicePeriod(card, m as YearMonth, overrides);
    const next = invoicePeriod(card, addMonths(m as YearMonth, 1), overrides);
    const credit = carryOverCredit(
      prev,
      invoiceTotals(prev.id, txs),
      next,
      { today, newId: () => '' },
      carryOverCategoryId,
    );
    if (!credit) {
      continue;
    }
    const current = byId.get(credit.id);
    if (current && current.deleted_at === null && current.amount_cents === credit.amountCents) {
      continue;
    }
    if (!have.has(next.referenceMonth) && !invoices.some((i) => i.id === next.id)) {
      invoices.push(buildInvoice(next, userId, nowIso));
    }
    transactions.push(
      txToRow({ ...credit, deletedAt: null }, current ?? blankTx(credit.id, userId, nowIso)),
    );
  }
  return { invoices, transactions };
}

/** RN-18: faturas para onde um item pode ir (não pagas, da atual até +3), menos a dele. */
export function moveTargets(
  card: Card,
  tx: Tx,
  txs: readonly Tx[],
  invoiceRows: readonly InvoiceRow[],
  today: ISODate,
): InvoicePeriod[] {
  const overrides = overridesOf(invoiceRows);
  const month = currentOpenInvoice(card, today, overrides).referenceMonth;
  const out: InvoicePeriod[] = [];
  for (let i = -1; i <= UPCOMING; i += 1) {
    const view = invoiceView(card, addMonths(month, i), txs, overrides, today);
    if (view.period.id !== tx.invoiceId && view.status !== 'paid') {
      out.push(view.period);
    }
  }
  return out;
}

/** Item movido: nova fatura e `invoice_pinned` (não é recalculado se o fechamento mudar, RN-18). */
export function movedRow(row: TxRow, target: InvoicePeriod): TxRow {
  return { ...row, invoice_id: target.id, invoice_pinned: true };
}

/** A fatura do item ainda aceita mudança (não está paga). */
export function canMove(view: InvoiceView | null): boolean {
  return view !== null && view.status !== 'paid';
}
