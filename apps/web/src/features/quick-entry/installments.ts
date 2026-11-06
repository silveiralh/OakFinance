// Compra parcelada no Q01 (US-20, RN-20..RN-23): só no crédito; Total ou Parcela (RN-20); divisão da RN-21 (resto
// na 1ª); parcela k na fatura F1 + k − 1 (RN-22); id v5 por (série, k). Grava o plano, as faturas que faltam e as
// parcelas numa transação.
import {
  buildInstallments,
  type InvoiceDates,
  type ISODate,
  installmentAmounts,
  invoicePeriod,
  MAX_INSTALLMENTS,
  MIN_INSTALLMENTS,
  totalFromInstallment,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { cardFromRow } from '../../data/mappers';
import { putInTransaction, writeScope } from '../../data/repositories/rows';
import type { Result } from '../../data/result';
import { writeLocal } from '../../data/storage';
import { deviceId } from '../../data/sync/clock';
import { buildInvoice } from './model';

export type InstallmentMode = 'total' | 'installment';

/** Total da compra pelo modo (RN-20: no modo parcela, total = parcela × n). */
export function installmentTotal(
  amountCents: number,
  count: number,
  mode: InstallmentMode,
): number {
  return mode === 'installment' ? totalFromInstallment(amountCents, count) : amountCents;
}

export type InstallmentProblem = 'count' | 'minTotal';

/** RN-20: 2 a 48 parcelas e pelo menos 1 centavo por parcela. */
export function installmentProblem(
  amountCents: number,
  count: number,
  mode: InstallmentMode,
): InstallmentProblem | null {
  if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) {
    return 'count';
  }
  if (installmentTotal(amountCents, count, mode) < count) {
    return 'minTotal';
  }
  return null;
}

/** Valores das parcelas (RN-21) para a prévia e os testes. */
export function installmentSplit(
  amountCents: number,
  count: number,
  mode: InstallmentMode,
): number[] {
  return installmentAmounts(installmentTotal(amountCents, count, mode), count);
}

export interface InstallmentPurchase {
  seriesId: string;
  userId: string;
  card: LocalRow<'cards'>;
  invoices: readonly LocalRow<'invoices'>[];
  /** Linha base da compra (descrição, categoria, meio…) montada pelo Q01. */
  base: LocalRow<'transactions'>;
  amountCents: number;
  count: number;
  mode: InstallmentMode;
  purchaseDate: ISODate;
  nowIso: string;
}

export interface InstallmentRows {
  plan: LocalRow<'installment_plans'>;
  invoices: LocalRow<'invoices'>[];
  parcels: LocalRow<'transactions'>[];
}

function overridesOf(rows: readonly LocalRow<'invoices'>[]): InvoiceDates[] {
  return rows
    .filter((r) => r.deleted_at === null && r.is_manual_dates)
    .map((r) => ({
      referenceMonth: r.reference_month.slice(0, 7) as InvoiceDates['referenceMonth'],
      closingDate: r.closing_date as ISODate,
      dueDate: r.due_date as ISODate,
    }));
}

/** Plano, faturas que faltam e parcelas da compra (sem gravar). */
export function installmentRows(input: InstallmentPurchase): InstallmentRows {
  const total = installmentTotal(input.amountCents, input.count, input.mode);
  const card = cardFromRow(input.card);
  const own = input.invoices.filter((r) => r.card_id === card.id);
  const drafts = buildInstallments(
    {
      seriesId: input.seriesId,
      cardId: card.id,
      accountId: null,
      purchaseDate: input.purchaseDate,
      totalCents: total,
      count: input.count,
      description: input.base.description ?? '',
      categoryId: input.base.category_id,
    },
    card,
    overridesOf(own),
  );
  const have = new Set(own.filter((r) => r.deleted_at === null).map((r) => r.id));
  const invoices: LocalRow<'invoices'>[] = [];
  for (const d of drafts) {
    if (d.invoiceId && d.invoiceReferenceMonth && !have.has(d.invoiceId)) {
      have.add(d.invoiceId);
      const period = {
        id: d.invoiceId,
        cardId: card.id,
        referenceMonth: d.invoiceReferenceMonth,
        ...datesOf(card, d.invoiceReferenceMonth, own),
      };
      invoices.push(buildInvoice(period, input.userId, input.nowIso));
    }
  }
  const plan: LocalRow<'installment_plans'> = {
    id: input.seriesId,
    user_id: input.userId,
    card_id: card.id,
    account_id: null,
    category_id: input.base.category_id,
    description: input.base.description ?? '',
    payment_method: 'credit',
    purchase_date: input.purchaseDate,
    first_due_on: null,
    first_installment_cents: null,
    installments_count: input.count,
    start_installment: 1,
    total_cents: total,
    source: 'manual',
    created_at: input.nowIso,
    updated_at: input.nowIso,
    client_updated_at: input.nowIso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
  const parcels = drafts.map((d) => ({
    ...input.base,
    id: d.id,
    amount_cents: d.amountCents,
    occurred_on: d.occurredOn,
    invoice_id: d.invoiceId,
    series_id: input.seriesId,
    installment_number: d.installmentNumber,
    installment_count: d.installmentCount,
    source: 'manual',
  }));
  return { plan, invoices, parcels };
}

function datesOf(
  card: ReturnType<typeof cardFromRow>,
  month: InvoiceDates['referenceMonth'],
  rows: readonly LocalRow<'invoices'>[],
): { closingDate: ISODate; dueDate: ISODate } {
  const p = invoicePeriod(card, month, overridesOf(rows));
  return { closingDate: p.closingDate, dueDate: p.dueDate };
}

/** Grava o plano, as faturas e as parcelas na mesma transação (o plano primeiro na fila: FK das parcelas). */
export async function saveInstallmentPurchase(
  db: OakDb,
  rows: InstallmentRows,
  nowMs: number = Date.now(),
): Promise<Result<number>> {
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction(
      'rw',
      writeScope(['installment_plans', 'invoices', 'transactions']),
      async () => {
        await putInTransaction(db, 'installment_plans', rows.plan, device, nowMs);
        for (const row of rows.invoices) {
          await putInTransaction(db, 'invoices', row, device, nowMs);
        }
        for (const row of rows.parcels) {
          await putInTransaction(db, 'transactions', row, device, nowMs);
        }
        return rows.parcels.length;
      },
    ),
  );
}
