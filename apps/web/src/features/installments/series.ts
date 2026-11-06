// Editar e cancelar compra parcelada (US-21, RN-24, RN-25): escopo "Toda a compra" / "Só esta parcela" para
// descrição, categoria e observação; total, número de parcelas e data regeneram a série (mesmo `series_id`) só sem
// fatura paga ou parcial; "Cancelar parcelas restantes" (abertas e futuras) e "Apagar a compra inteira".
import {
  addMonths,
  cancelRemainingInstallments,
  DomainError,
  type InvoiceStatus,
  type ISODate,
  invoicePeriod,
  rescheduleInstallments,
  type Tx,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { cardFromRow, txFromRow } from '../../data/mappers';
import { deleteSeries } from '../../data/repositories/cascade';
import { putInTransaction, writeScope } from '../../data/repositories/rows';
import { err, type Result } from '../../data/result';
import { writeLocal } from '../../data/storage';
import { deviceId } from '../../data/sync/clock';
import { invoiceView, overridesOf } from '../cards/model';
import { buildInvoice } from '../quick-entry/model';

type TxRow = LocalRow<'transactions'>;

export interface SeriesData {
  plan: LocalRow<'installment_plans'>;
  card: LocalRow<'cards'>;
  parcels: TxRow[];
  invoices: LocalRow<'invoices'>[];
  /** Lançamentos do cartão (para o status das faturas). */
  cardTxs: TxRow[];
}

export async function loadSeries(db: OakDb, seriesId: string): Promise<SeriesData | null> {
  const plan = await db.installment_plans.get(seriesId);
  if (!plan || plan.deleted_at !== null || !plan.card_id) {
    return null;
  }
  const card = await db.cards.get(plan.card_id);
  if (!card) {
    return null;
  }
  const cardTxs = (await db.transactions.toArray()).filter(
    (r) => r.card_id === card.id || r.counterpart_card_id === card.id,
  );
  return {
    plan,
    card,
    parcels: cardTxs.filter((r) => r.series_id === seriesId && r.deleted_at === null),
    invoices: await db.invoices.where('card_id').equals(card.id).toArray(),
    cardTxs,
  };
}

function toTxs(rows: readonly TxRow[]): Tx[] {
  return rows.flatMap((r) => {
    try {
      return [txFromRow(r)];
    } catch {
      return [];
    }
  });
}

/** Mês de cada fatura do cartão: as salvas e as v5 em volta da compra (a linha da fatura pode não ter chegado). */
function invoiceMonths(data: SeriesData): Map<string, YearMonth> {
  const card = cardFromRow(data.card);
  const overrides = overridesOf(data.invoices);
  const months = new Map<string, YearMonth>(
    data.invoices.map((r) => [r.id, r.reference_month.slice(0, 7) as YearMonth]),
  );
  const start = data.plan.purchase_date.slice(0, 7) as YearMonth;
  for (let i = -2; i < data.plan.installments_count + 3; i += 1) {
    const p = invoicePeriod(card, addMonths(start, i), overrides);
    if (!months.has(p.id)) {
      months.set(p.id, p.referenceMonth);
    }
  }
  return months;
}

/** Status (RN-14) da fatura de cada id. */
export function statusLookup(
  data: SeriesData,
  today: ISODate,
): (invoiceId: string) => InvoiceStatus {
  const card = cardFromRow(data.card);
  const txs = toTxs(data.cardTxs);
  const overrides = overridesOf(data.invoices);
  const months = invoiceMonths(data);
  return (invoiceId) => {
    const month = months.get(invoiceId);
    return month ? invoiceView(card, month, txs, overrides, today).status : 'future';
  };
}

export type FieldScope = 'series' | 'one';

export interface SeriesFields {
  description?: string | null;
  categoryId?: string | null;
  notes?: string | null;
}

/** RN-24(a): descrição, categoria e observação na compra toda (padrão) ou só na parcela. */
export async function editSeriesFields(
  db: OakDb,
  data: SeriesData,
  parcelId: string,
  fields: SeriesFields,
  scope: FieldScope,
  nowMs: number = Date.now(),
): Promise<Result<number>> {
  const device = await deviceId(db);
  const targets = scope === 'series' ? data.parcels : data.parcels.filter((r) => r.id === parcelId);
  const patch = (row: TxRow): TxRow => ({
    ...row,
    ...(fields.description !== undefined ? { description: fields.description } : {}),
    ...(fields.categoryId !== undefined
      ? { category_id: fields.categoryId, category_source: 'manual' }
      : {}),
    ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
  });
  return writeLocal(() =>
    db.transaction('rw', writeScope(['transactions', 'installment_plans']), async () => {
      for (const row of targets) {
        await putInTransaction(db, 'transactions', patch(row), device, nowMs);
      }
      if (scope === 'series') {
        await putInTransaction(
          db,
          'installment_plans',
          {
            ...data.plan,
            ...(fields.description !== undefined ? { description: fields.description ?? '' } : {}),
            ...(fields.categoryId !== undefined ? { category_id: fields.categoryId } : {}),
          },
          device,
          nowMs,
        );
      }
      return targets.length;
    }),
  );
}

export interface SeriesShape {
  totalCents: number;
  count: number;
}

export type SeriesError = { code: 'INSTALLMENTS_LOCKED' | 'INVALID'; message: string };

/**
 * RN-24(b): total e número de parcelas regeneram a série inteira (mesmo `series_id`, RN-21/RN-22), só sem parcela em
 * fatura paga ou parcial; senão `INSTALLMENTS_LOCKED` com o texto da RN-24.
 */
export async function reshapeSeries(
  db: OakDb,
  data: SeriesData,
  shape: SeriesShape,
  today: ISODate,
  nowMs: number = Date.now(),
): Promise<Result<number, SeriesError | { code: string; message: string }>> {
  const card = cardFromRow(data.card);
  const overrides = overridesOf(data.invoices);
  let plan: ReturnType<typeof rescheduleInstallments>;
  try {
    plan = rescheduleInstallments(
      toTxs(data.parcels),
      {
        seriesId: data.plan.id,
        cardId: card.id,
        accountId: null,
        purchaseDate: data.plan.purchase_date as ISODate,
        totalCents: shape.totalCents,
        count: shape.count,
        description: data.plan.description,
        categoryId: data.plan.category_id,
      },
      card,
      statusLookup(data, today),
      overrides,
    );
  } catch (error) {
    if (error instanceof DomainError) {
      return err({
        code: error.code === 'INSTALLMENTS_LOCKED' ? 'INSTALLMENTS_LOCKED' : 'INVALID',
        message: error.message,
      });
    }
    throw error;
  }
  const template = data.parcels.find((r) => r.installment_number === 1) ?? data.parcels[0];
  if (!template) {
    return err({ code: 'INVALID', message: 'série sem parcelas' });
  }
  const device = await deviceId(db);
  const iso = new Date(nowMs).toISOString();
  const have = new Set(data.invoices.filter((r) => r.deleted_at === null).map((r) => r.id));
  const byId = new Map(data.parcels.map((r) => [r.id, r]));
  return writeLocal(() =>
    db.transaction(
      'rw',
      writeScope(['transactions', 'installment_plans', 'invoices']),
      async () => {
        await putInTransaction(
          db,
          'installment_plans',
          { ...data.plan, total_cents: shape.totalCents, installments_count: shape.count },
          device,
          nowMs,
        );
        for (const d of plan.upsert) {
          if (d.invoiceId && d.invoiceReferenceMonth && !have.has(d.invoiceId)) {
            const p = invoicePeriod(card, d.invoiceReferenceMonth, overrides);
            await putInTransaction(
              db,
              'invoices',
              buildInvoice(p, data.plan.user_id, iso),
              device,
              nowMs,
            );
            have.add(d.invoiceId);
          }
          await putInTransaction(
            db,
            'transactions',
            {
              ...(byId.get(d.id) ?? template),
              id: d.id,
              amount_cents: d.amountCents,
              occurred_on: d.occurredOn,
              invoice_id: d.invoiceId,
              installment_number: d.installmentNumber,
              installment_count: d.installmentCount,
              status: 'posted',
              deleted_at: null,
            },
            device,
            nowMs,
          );
        }
        for (const id of plan.softDelete) {
          const row = byId.get(id);
          if (row) {
            await putInTransaction(db, 'transactions', { ...row, deleted_at: iso }, device, nowMs);
          }
        }
        return plan.upsert.length;
      },
    ),
  );
}

/** RN-25: parcelas em faturas abertas e futuras ficam canceladas; as demais ficam. */
export async function cancelRemaining(
  db: OakDb,
  data: SeriesData,
  today: ISODate,
  nowMs: number = Date.now(),
): Promise<Result<number>> {
  const ids = new Set(cancelRemainingInstallments(toTxs(data.parcels), statusLookup(data, today)));
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction('rw', writeScope(['transactions']), async () => {
      for (const row of data.parcels) {
        if (ids.has(row.id)) {
          await putInTransaction(
            db,
            'transactions',
            { ...row, status: 'cancelled' },
            device,
            nowMs,
          );
        }
      }
      return ids.size;
    }),
  );
}

/** RN-25: o que cada fatura paga deixará de mostrar se a compra for apagada ("A fatura de {mês}…"). */
export function paidLosses(
  data: SeriesData,
  today: ISODate,
): Array<{ month: YearMonth; amountCents: number }> {
  const status = statusLookup(data, today);
  const months = invoiceMonths(data);
  const byMonth = new Map<YearMonth, number>();
  for (const row of data.parcels) {
    const month = row.invoice_id ? months.get(row.invoice_id) : undefined;
    if (
      month &&
      row.invoice_id &&
      row.status !== 'cancelled' &&
      status(row.invoice_id) === 'paid'
    ) {
      byMonth.set(month, (byMonth.get(month) ?? 0) + row.amount_cents);
    }
  }
  return [...byMonth].sort().map(([month, amountCents]) => ({ month, amountCents }));
}

/** RN-25: "Apagar a compra inteira" (exclusão lógica do plano e de todas as parcelas). */
export function deleteWholeSeries(db: OakDb, seriesId: string) {
  return deleteSeries(db, seriesId);
}
