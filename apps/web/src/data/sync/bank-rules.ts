// Regras de importação que vêm antes da conciliação comum (US-50; RN-19, RN-69, RN-71), usadas pelo
// `reconcile-runner`. Funções puras: devolvem as linhas a gravar e os importados já resolvidos.
// - RN-69: parcela importada concilia com a parcela k de uma série existente; sem série, cria a série (k = 1) ou
//   as parcelas k..n ("importada parcialmente") e concilia com a parcela k criada;
// - RN-71 (1º item): saída na conta que paga uma fatura vira pagamento de fatura (transferência para o cartão);
// - RN-71 (2º item): "Pagamento recebido" no cartão fica `ignored`.
// Ids determinísticos (série v5 a partir do importado, parcelas `installmentTxId`): dois aparelhos que rodem a
// mesma regra gravam as mesmas linhas, sem duplicar.
import {
  buildInstallments,
  type Card,
  detectIgnoredCardCredits,
  detectInvoicePayments,
  type InvoiceDates,
  type ISODate,
  importedInstallmentPlan,
  installmentMarkerOf,
  installmentTxId,
  invoicePaymentPatch,
  invoicePeriod,
  invoiceStatus,
  invoiceTotals,
  linkImportedInstallment,
  type PayableInvoice,
  planMerge,
  type ReconItem,
  type YearMonth,
} from '@oakfinance/domain';
import { v5 } from 'uuid';
import type { LocalRow } from '../db';
import { cardFromRow, txFromRow } from '../mappers';

type TxRow = LocalRow<'transactions'>;

/** Namespace fixo das séries criadas a partir de uma parcela importada (gerado em 07/11/2026). [CONTRATO] */
export const NS_IMPORTED_SERIES = '4b1f6c2e-9d3a-5e7b-8c1d-2f6a9e0b7c41';

export function importedSeriesId(importedId: string): string {
  return v5(importedId, NS_IMPORTED_SERIES);
}

export interface BankRulesContext {
  userId: string;
  today: ISODate;
  nowIso: string;
  cards: readonly LocalRow<'cards'>[];
  invoices: readonly LocalRow<'invoices'>[];
  plans: readonly LocalRow<'installment_plans'>[];
  /** Todos os lançamentos vivos do aparelho (para as parcelas e os totais das faturas). */
  txs: readonly TxRow[];
  itemOf: (row: TxRow) => ReconItem;
}

export interface BankRulesResult {
  /** Importados resolvidos aqui (não passam pela conciliação comum). */
  handled: Set<string>;
  transactions: TxRow[];
  plans: LocalRow<'installment_plans'>[];
  invoices: LocalRow<'invoices'>[];
  installments: number;
  payments: number;
  ignored: number;
}

function overridesOf(rows: readonly LocalRow<'invoices'>[]): InvoiceDates[] {
  return rows
    .filter((r) => r.deleted_at === null && r.is_manual_dates)
    .map((r) => ({
      referenceMonth: r.reference_month.slice(0, 7) as YearMonth,
      closingDate: r.closing_date as ISODate,
      dueDate: r.due_date as ISODate,
    }));
}

function invoiceRow(
  ctx: BankRulesContext,
  card: Card,
  month: YearMonth,
  overrides: readonly InvoiceDates[],
): LocalRow<'invoices'> {
  const period = invoicePeriod(card, month, overrides);
  return {
    id: period.id,
    user_id: ctx.userId,
    card_id: card.id,
    reference_month: `${month}-01`,
    closing_date: period.closingDate,
    due_date: period.dueDate,
    is_manual_dates: false,
    external_bill_id: null,
    external_min_payment_cents: null,
    external_total_cents: null,
    notes: null,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
    client_updated_at: ctx.nowIso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
}

/** Manual (parcela) depois do `planMerge`: vínculo, efetivado e a fatura do banco quando o importado a trouxe. */
function mergedPair(ctx: BankRulesContext, imported: TxRow, manual: TxRow): [TxRow, TxRow] {
  const plan = planMerge(ctx.itemOf(imported), ctx.itemOf(manual), {
    approx: false,
    ...(imported.card_id && imported.invoice_pinned && imported.invoice_id
      ? { bankInvoiceId: imported.invoice_id }
      : {}),
  });
  const patch = plan.manualPatch;
  return [
    { ...imported, review_state: 'merged', duplicate_of: manual.id },
    {
      ...manual,
      matched_external: true,
      status: patch.status,
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.invoiceId !== undefined
        ? { invoice_id: patch.invoiceId, invoice_pinned: true }
        : {}),
    },
  ];
}

/** RN-69 para um importado de cartão com marcador de parcela; `null` quando não é parcela. */
function installmentRule(
  ctx: BankRulesContext,
  imported: TxRow,
  byId: Map<string, TxRow>,
  result: BankRulesResult,
): boolean {
  const cardRow = ctx.cards.find((c) => c.id === imported.card_id && c.deleted_at === null);
  if (!cardRow) {
    return false;
  }
  const item = ctx.itemOf(imported);
  const candidates = ctx.plans
    .filter((p) => p.deleted_at === null && p.card_id === cardRow.id)
    .map((p) => ({
      id: p.id,
      cardId: p.card_id,
      count: p.installments_count,
      totalCents: p.total_cents,
      purchaseDate: p.purchase_date as ISODate,
      firstInstallmentCents: p.first_installment_cents,
    }));
  const linked = linkImportedInstallment(item, candidates);
  if (linked) {
    const marker = installmentMarkerOf(item);
    const parcel = marker ? byId.get(installmentTxId(linked.seriesId, marker.number)) : undefined;
    if (parcel && !parcel.matched_external) {
      const [a, b] = mergedPair(ctx, imported, parcel);
      result.transactions.push(a, b);
      byId.set(b.id, b);
      result.installments += 1;
      return true;
    }
    return false;
  }
  const seriesId = importedSeriesId(imported.id);
  const plan = importedInstallmentPlan(item, seriesId, { categoryId: imported.category_id });
  if (!plan) {
    return false;
  }
  const card = cardFromRow(cardRow);
  const own = ctx.invoices.filter((inv) => inv.card_id === card.id);
  const overrides = overridesOf(own);
  const drafts = buildInstallments(plan, card, overrides);
  const known = new Set(
    [...own.filter((inv) => inv.deleted_at === null), ...result.invoices].map((inv) => inv.id),
  );
  for (const d of drafts) {
    if (d.invoiceId && d.invoiceReferenceMonth && !known.has(d.invoiceId)) {
      known.add(d.invoiceId);
      result.invoices.push(invoiceRow(ctx, card, d.invoiceReferenceMonth, overrides));
    }
  }
  result.plans.push({
    id: seriesId,
    user_id: ctx.userId,
    card_id: card.id,
    account_id: null,
    category_id: imported.category_id,
    description: (plan.description || imported.description || 'Compra parcelada').slice(0, 120),
    payment_method: 'credit',
    purchase_date: plan.purchaseDate,
    first_due_on: null,
    first_installment_cents: null,
    installments_count: plan.count,
    start_installment: plan.startInstallment ?? 1,
    total_cents: plan.totalCents,
    source: imported.source,
    created_at: ctx.nowIso,
    updated_at: ctx.nowIso,
    client_updated_at: ctx.nowIso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  });
  let parcelK: TxRow | null = null;
  for (const d of drafts) {
    const parcel: TxRow = {
      ...imported,
      id: d.id,
      amount_cents: d.amountCents,
      occurred_on: d.occurredOn,
      occurred_at: null,
      invoice_id: d.invoiceId,
      invoice_pinned: false,
      series_id: seriesId,
      installment_number: d.installmentNumber,
      installment_count: d.installmentCount,
      description: plan.description || imported.description,
      description_raw: null,
      source: 'installment',
      external_id: null,
      external_meta: null,
      review_state: 'ok',
      duplicate_of: null,
      matched_external: false,
      import_id: null,
      created_at: ctx.nowIso,
      updated_at: ctx.nowIso,
      client_updated_at: ctx.nowIso,
      server_version: 0,
      device_id: null,
      _pending: 0,
    };
    if (d.installmentNumber === plan.startInstallment) {
      parcelK = parcel;
    } else {
      result.transactions.push(parcel);
    }
  }
  if (!parcelK) {
    return false;
  }
  const [a, b] = mergedPair(ctx, imported, parcelK);
  result.transactions.push(b, a);
  result.installments += 1;
  return true;
}

/** Aplica RN-69 e RN-71 aos importados novos. */
export function applyBankRules(
  candidates: readonly TxRow[],
  ctx: BankRulesContext,
): BankRulesResult {
  const result: BankRulesResult = {
    handled: new Set(),
    transactions: [],
    plans: [],
    invoices: [],
    installments: 0,
    payments: 0,
    ignored: 0,
  };
  const byId = new Map(ctx.txs.map((row) => [row.id, row]));

  // RN-69: parcelas no cartão
  for (const imported of candidates) {
    const isInstallment =
      imported.card_id !== null && installmentMarkerOf(ctx.itemOf(imported)) !== null;
    if (isInstallment && installmentRule(ctx, imported, byId, result)) {
      result.handled.add(imported.id);
    }
  }

  const rest = candidates.filter((row) => !result.handled.has(row.id));
  const restTx = rest.map(txFromRow);

  // RN-71 (2º item): "Pagamento recebido" no cartão
  for (const id of detectIgnoredCardCredits(restTx)) {
    const row = rest.find((r) => r.id === id);
    if (row) {
      result.transactions.push({ ...row, review_state: 'ignored' });
      result.handled.add(id);
      result.ignored += 1;
    }
  }

  // RN-71 (1º item): pagamento de fatura saindo da conta
  const allTx = ctx.txs.map(txFromRow);
  const payable: PayableInvoice[] = [];
  for (const inv of ctx.invoices) {
    const cardRow = ctx.cards.find((c) => c.id === inv.card_id);
    if (!cardRow || inv.deleted_at !== null) {
      continue;
    }
    const card = cardFromRow(cardRow);
    const own = ctx.invoices.filter((i) => i.card_id === card.id);
    const period = {
      ...invoicePeriod(card, inv.reference_month.slice(0, 7) as YearMonth, overridesOf(own)),
      id: inv.id,
      closingDate: inv.closing_date as ISODate,
      dueDate: inv.due_date as ISODate,
    };
    const totals = invoiceTotals(inv.id, allTx);
    payable.push({ ...period, totals, status: invoiceStatus(period, totals, ctx.today) });
  }
  const unhandled = restTx.filter((tx) => !result.handled.has(tx.id));
  for (const match of detectInvoicePayments(unhandled, payable)) {
    const row = rest.find((r) => r.id === match.txId);
    const invoice = payable.find((p) => p.id === match.invoiceId);
    if (!row || !invoice) {
      continue;
    }
    const patch = invoicePaymentPatch(match, invoice);
    result.transactions.push({
      ...row,
      kind: patch.kind,
      counterpart_card_id: patch.counterpartCardId,
      invoice_id: patch.invoiceId,
      category_id: patch.categoryId,
      category_source: 'none',
      review_state: patch.reviewState,
    });
    result.handled.add(row.id);
    result.payments += 1;
  }
  return result;
}
