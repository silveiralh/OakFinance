// Editar cartão na S03 (US-11, RN-17): valida como no cadastro, recalcula a fatura dos itens de faturas abertas e
// futuras sem `invoice_pinned` e grava faturas, itens e cartão na mesma transação.
import type { ISODate } from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { cardFromRow } from '../../data/mappers';
import {
  type CardError,
  type CardInput,
  editedCardRow,
  saveCardChange,
  validateCard,
} from '../../data/repositories/cards';
import { err, ok, type Result } from '../../data/result';
import { type CardChangePlan, planCardChange } from './model';

/** Prévia da RN-17 para o formulário: o que muda se o cartão salvo virar `input`. */
export function previewCardChange(
  current: LocalRow<'cards'>,
  input: CardInput,
  invoices: readonly LocalRow<'invoices'>[],
  transactions: readonly LocalRow<'transactions'>[],
  today: ISODate,
  userId: string,
  nowIso: string,
): CardChangePlan {
  return planCardChange(
    cardFromRow(current),
    cardFromRow(editedCardRow(current, input)),
    invoices,
    transactions,
    today,
    userId,
    nowIso,
  );
}

export async function editCard(
  db: OakDb,
  userId: string,
  id: string,
  input: CardInput,
  today: ISODate,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<Result<{ moved: number }, CardError | { code: string; message: string }>> {
  const current = await db.cards.get(id);
  if (!current || current.deleted_at !== null) {
    return err({ code: 'CARD_NOT_FOUND', message: id });
  }
  const problem = validateCard(input, await db.cards.toArray(), id);
  if (problem) {
    return err(problem);
  }
  const plan = previewCardChange(
    current,
    input,
    await db.invoices.where('card_id').equals(id).toArray(),
    await db.transactions.where('card_id').equals(id).toArray(),
    today,
    userId,
    new Date(nowMs).toISOString(),
  );
  const saved = await saveCardChange(
    db,
    editedCardRow(current, input),
    plan.invoices,
    plan.transactions,
    { nowMs },
  );
  return saved.ok ? ok({ moved: plan.count }) : saved;
}
