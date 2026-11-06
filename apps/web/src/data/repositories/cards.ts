// Cartões (US-10, RN-09..RN-12): fechamento e vencimento entre 1 e 31, regra do dia do fechamento (padrão: a
// compra no dia vai para a próxima fatura), conta que paga e limite opcional. Mesma regra de nome da RN-07.
import {
  type Card,
  currentOpenInvoice,
  type InvoicePeriod,
  type ISODate,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../db';
import { newId } from '../ids';
import { cardFromRow } from '../mappers';
import { err, type Result } from '../result';
import { NAME_MAX } from './accounts';
import { deleteCard as cascadeDeleteCard } from './cascade';
import { saveRow } from './rows';

export type DayProblem = 'invalid';

/** Dia de fechamento ou vencimento: inteiro de 1 a 31 (US-10, "Dias inválidos"). */
export function parseDay(text: string): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) {
    return null;
  }
  const day = Number(text.trim());
  return day >= 1 && day <= 31 ? day : null;
}

export interface CardInput {
  name: string;
  closingDay: number;
  dueDay: number;
  /** `true` (padrão, RN-09): compra no dia do fechamento vai para a próxima fatura. */
  closingDayToNext?: boolean;
  limitCents?: number | null;
  paymentAccountId?: string | null;
}

export type CardError =
  | { code: 'CARD_NAME'; problem: 'required' | 'tooLong' | 'duplicate'; message: string }
  | { code: 'CARD_DAY'; field: 'closing' | 'due'; message: string }
  | { code: 'CARD_HAS_TRANSACTIONS'; message: string }
  | { code: 'CARD_NOT_FOUND'; message: string };

type CardResult = Result<LocalRow<'cards'> | null, CardError | { code: string; message: string }>;

function folded(name: string) {
  return name.trim().toLocaleLowerCase('pt-BR');
}

export function cardNameProblem(
  name: string,
  cards: readonly LocalRow<'cards'>[],
  selfId?: string,
): 'required' | 'tooLong' | 'duplicate' | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'required';
  }
  if (trimmed.length > NAME_MAX) {
    return 'tooLong';
  }
  return cards.some(
    (row) =>
      row.id !== selfId &&
      row.deleted_at === null &&
      row.archived_at === null &&
      folded(row.name) === folded(trimmed),
  )
    ? 'duplicate'
    : null;
}

/** Cartão do domínio a partir do formulário (para a prévia antes de salvar). */
export function draftCard(
  input: Pick<CardInput, 'closingDay' | 'dueDay' | 'closingDayToNext'>,
): Card {
  return {
    id: 'previa',
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    closingDayRule: input.closingDayToNext === false ? 'same' : 'next',
    limitCents: null,
    paymentAccountId: null,
  };
}

/** Prévia da RN-12: a fatura que recebe uma compra feita hoje. */
export function previewInvoice(card: Card, today: ISODate): InvoicePeriod {
  return currentOpenInvoice(card, today);
}

function validate(
  input: CardInput,
  cards: readonly LocalRow<'cards'>[],
  selfId?: string,
): CardError | null {
  const problem = cardNameProblem(input.name, cards, selfId);
  if (problem) {
    return { code: 'CARD_NAME', problem, message: problem };
  }
  for (const [field, day] of [
    ['closing', input.closingDay],
    ['due', input.dueDay],
  ] as const) {
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return { code: 'CARD_DAY', field, message: 'Escolha um dia entre 1 e 31.' };
    }
  }
  return null;
}

export async function createCard(
  db: OakDb,
  userId: string,
  input: CardInput,
  { nowMs = Date.now(), id = newId() }: { nowMs?: number; id?: string } = {},
): Promise<CardResult> {
  const problem = validate(input, await db.cards.toArray());
  if (problem) {
    return err(problem);
  }
  const iso = new Date(nowMs).toISOString();
  const row: LocalRow<'cards'> = {
    id,
    user_id: userId,
    name: input.name.trim(),
    closing_day: input.closingDay,
    due_day: input.dueDay,
    closing_day_rule: input.closingDayToNext === false ? 'same' : 'next',
    limit_cents: input.limitCents ?? null,
    payment_account_id: input.paymentAccountId ?? null,
    brand: null,
    institution: null,
    last4: null,
    color: null,
    icon: null,
    sort_order: await db.cards.count(),
    archived_at: null,
    created_at: iso,
    updated_at: iso,
    client_updated_at: iso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
  return saveRow(db, 'cards', row, { nowMs });
}

/** Lançamentos vivos no cartão. */
export function cardUsage(db: OakDb, id: string): Promise<number> {
  return db.transactions
    .where('card_id')
    .equals(id)
    .filter((t) => t.deleted_at === null)
    .count();
}

export async function archiveCard(
  db: OakDb,
  id: string,
  { nowMs = Date.now() } = {},
): Promise<CardResult> {
  const current = await db.cards.get(id);
  if (!current || current.deleted_at !== null) {
    return err({ code: 'CARD_NOT_FOUND', message: id });
  }
  return saveRow(
    db,
    'cards',
    { ...current, archived_at: new Date(nowMs).toISOString() },
    { nowMs },
  );
}

/** Excluir só sem lançamentos (RN-07); as faturas vazias saem junto (cascata da tech §4.4). */
export async function removeCard(
  db: OakDb,
  id: string,
  { nowMs = Date.now() } = {},
): Promise<Result<number, CardError | { code: string; message: string }>> {
  if ((await cardUsage(db, id)) > 0) {
    return err({ code: 'CARD_HAS_TRANSACTIONS', message: id });
  }
  return cascadeDeleteCard(db, id, { nowMs });
}

/** Cartão salvo no formato do domínio. */
export function toCard(row: LocalRow<'cards'>): Card {
  return cardFromRow(row);
}
