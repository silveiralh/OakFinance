// Editar cartão (US-11, RN-17, RN-18): mudar fechamento, vencimento ou a regra recalcula pela RN-12 só os itens de
// faturas abertas e futuras sem `invoice_pinned`; a prévia conta esses itens ("{n} itens podem mudar de fatura").
import {
  addMonths,
  type Card,
  type ISODate,
  invoiceForPurchase,
  invoicePeriod,
  reassignCardItems,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../db';
import { cardFromRow, txFromRow } from '../mappers';
import { err, type Result } from '../result';
import { writeLocal } from '../storage';
import { deviceId } from '../sync/clock';
import { type CardError, type CardInput, cardNameProblem } from './cards';
import { putInTransaction, saveRow, writeScope } from './rows';

type TxRow = LocalRow<'transactions'>;
type InvoiceRow = LocalRow<'invoices'>;

function overridesOf(rows: readonly InvoiceRow[]) {
  return rows
    .filter((r) => r.deleted_at === null && r.is_manual_dates)
    .map((r) => ({
      referenceMonth: r.reference_month.slice(0, 7) as YearMonth,
      closingDate: r.closing_date as ISODate,
      dueDate: r.due_date as ISODate,
    }));
}

/** Itens que podem mudar de fatura: compras e estornos do cartão em fatura aberta ou futura, sem fatura fixada. */
export function changeCandidates(
  card: Card,
  txRows: readonly TxRow[],
  invoiceRows: readonly InvoiceRow[],
  today: ISODate,
): TxRow[] {
  const overrides = overridesOf(invoiceRows);
  return txRows.filter((row) => {
    if (
      row.card_id !== card.id ||
      row.deleted_at !== null ||
      row.invoice_pinned ||
      (row.kind !== 'expense' && row.kind !== 'refund')
    ) {
      return false;
    }
    const shift = (row.installment_number ?? 1) - 1;
    const period = invoicePeriod(
      card,
      addMonths(
        invoiceForPurchase(card, row.occurred_on as ISODate, overrides).referenceMonth,
        shift,
      ),
      overrides,
    );
    return today <= period.periodEnd;
  });
}

/** O formulário mudou as datas ou a regra (o que dispara a RN-17). */
export function datesChanged(row: LocalRow<'cards'>, input: CardInput): boolean {
  return (
    row.closing_day !== input.closingDay ||
    row.due_day !== input.dueDay ||
    row.closing_day_rule !== (input.closingDayToNext === false ? 'same' : 'next')
  );
}

export interface CardUpdate {
  card: LocalRow<'cards'>;
  /** Itens que mudaram de fatura. */
  moved: number;
}

function invoiceRow(
  period: ReturnType<typeof invoicePeriod>,
  base: InvoiceRow | undefined,
  userId: string,
  iso: string,
): InvoiceRow {
  return {
    ...(base ?? {
      id: period.id,
      user_id: userId,
      card_id: period.cardId,
      is_manual_dates: false,
      external_bill_id: null,
      external_min_payment_cents: null,
      external_total_cents: null,
      notes: null,
      created_at: iso,
      updated_at: iso,
      client_updated_at: iso,
      deleted_at: null,
      server_version: 0,
      device_id: null,
    }),
    reference_month: `${period.referenceMonth}-01`,
    closing_date: period.closingDate,
    due_date: period.dueDate,
  };
}

/**
 * Salva o cartão e, se as datas ou a regra mudaram, recalcula a fatura dos itens elegíveis (RN-17) e as datas das
 * faturas abertas e futuras sem datas manuais, tudo na mesma transação.
 */
export async function updateCard(
  db: OakDb,
  id: string,
  input: CardInput,
  today: ISODate,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<Result<CardUpdate, CardError | { code: string; message: string }>> {
  const current = await db.cards.get(id);
  if (!current || current.deleted_at !== null) {
    return err({ code: 'CARD_NOT_FOUND', message: id });
  }
  const problem = cardNameProblem(input.name, await db.cards.toArray(), id);
  if (problem) {
    return err({ code: 'CARD_NAME', problem, message: problem });
  }
  for (const [field, day] of [
    ['closing', input.closingDay],
    ['due', input.dueDay],
  ] as const) {
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return err({ code: 'CARD_DAY', field, message: 'Escolha um dia entre 1 e 31.' });
    }
  }
  const next: LocalRow<'cards'> = {
    ...current,
    name: input.name.trim(),
    closing_day: input.closingDay,
    due_day: input.dueDay,
    closing_day_rule: input.closingDayToNext === false ? 'same' : 'next',
    limit_cents: input.limitCents ?? null,
    payment_account_id: input.paymentAccountId ?? null,
  };
  if (!datesChanged(current, input)) {
    const saved = await saveRow(db, 'cards', next, { nowMs });
    return saved.ok ? { ok: true, value: { card: saved.value, moved: 0 } } : saved;
  }
  const oldCard = cardFromRow(current);
  const newCard = cardFromRow(next);
  const txRows = await db.transactions.where('card_id').equals(id).toArray();
  const invoices = await db.invoices.where('card_id').equals(id).toArray();
  const overrides = overridesOf(invoices);
  const moves = reassignCardItems(
    oldCard,
    newCard,
    txRows.flatMap((r) => {
      try {
        return [txFromRow(r)];
      } catch {
        return [];
      }
    }),
    today,
    overrides,
  );
  const device = await deviceId(db);
  const iso = new Date(nowMs).toISOString();
  return writeLocal(() =>
    db.transaction('rw', writeScope(['cards', 'invoices', 'transactions']), async () => {
      const saved = await putInTransaction(db, 'cards', next, device, nowMs);
      const byId = new Map(invoices.map((r) => [r.id, r]));
      // faturas abertas e futuras (sem datas manuais) passam a ter as datas novas
      for (const row of invoices) {
        if (row.deleted_at !== null || row.is_manual_dates) {
          continue;
        }
        const month = row.reference_month.slice(0, 7) as YearMonth;
        if (today > invoicePeriod(oldCard, month, overrides).periodEnd) {
          continue;
        }
        const period = invoicePeriod(newCard, month, overrides);
        if (row.closing_date !== period.closingDate || row.due_date !== period.dueDate) {
          await putInTransaction(
            db,
            'invoices',
            invoiceRow(period, row, current.user_id, iso),
            device,
            nowMs,
          );
        }
      }
      for (const move of moves) {
        if (!byId.has(move.toInvoiceId)) {
          const period = invoicePeriod(newCard, move.toReferenceMonth, overrides);
          const row = invoiceRow(period, undefined, current.user_id, iso);
          await putInTransaction(db, 'invoices', row, device, nowMs);
          byId.set(row.id, row);
        }
        const tx = txRows.find((r) => r.id === move.txId);
        if (tx) {
          await putInTransaction(
            db,
            'transactions',
            { ...tx, invoice_id: move.toInvoiceId },
            device,
            nowMs,
          );
        }
      }
      return { card: saved, moved: moves.length };
    }),
  );
}

/** Desarquivar volta o cartão para o seletor, se o nome não colidir com um ativo. */
export async function unarchiveCard(
  db: OakDb,
  id: string,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<Result<LocalRow<'cards'>, CardError | { code: string; message: string }>> {
  const current = await db.cards.get(id);
  if (!current || current.deleted_at !== null) {
    return err({ code: 'CARD_NOT_FOUND', message: id });
  }
  const problem = cardNameProblem(current.name, await db.cards.toArray(), id);
  if (problem) {
    return err({ code: 'CARD_NAME', problem, message: problem });
  }
  return saveRow(db, 'cards', { ...current, archived_at: null }, { nowMs });
}
