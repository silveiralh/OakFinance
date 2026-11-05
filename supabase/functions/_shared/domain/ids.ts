// IDs determinísticos UUID v5 (tech §4.3, ADR-06). Namespaces gerados uma única vez em 05/11/2026
// e FIXOS: mudar qualquer um duplicaria faturas, parcelas e seeds já sincronizados. [CONTRATO]
import { v5 } from 'uuid';
import type { ISODate, YearMonth } from './types.ts';

export const NS_INVOICE = '81b5ff40-b11d-45b5-b47d-655b9b938598';
export const NS_INSTALLMENT = '89c7053e-c8fe-4633-9441-09abecf1c937';
export const NS_RECURRENCE = 'cac8f93e-4179-48d9-a11f-ded9aea946df';
export const NS_CATEGORY = '76836b72-fc4d-4d05-81ae-9f9bb7ed0783';
export const NS_RULE = 'e5b26558-d1b3-4084-8623-0e9374a20a41';
export const NS_REMINDER = '0d6cf13a-7ce5-49e9-baff-16c3640a0306';
export const NS_GOAL = 'f7bc8dd8-9e64-4b48-8049-0e40aa09d54a';
export const NS_RECEIPT_ITEM = '522e55f7-dc52-49aa-a23a-fd2548342c0b';
export const NS_PLUGGY_TX = '577d4c17-e9b7-475d-8407-68f61c116d67';
export const NS_CARRY_OVER = '89a39c8d-a421-4b44-9fb4-4d18eb214655';
export const NS_NOTICE = '36d42d65-b00f-4d7e-bc3c-8bf814acd357';
export const NS_MONTH = '1e2c9c5b-d68d-4855-8be9-039b82184623';

export function invoiceId(cardId: string, referenceMonth: YearMonth): string {
  return v5(`${cardId}:${referenceMonth}`, NS_INVOICE);
}

export function installmentTxId(seriesId: string, n: number): string {
  return v5(`${seriesId}:${n}`, NS_INSTALLMENT);
}

export function recurrenceTxId(recurrenceId: string, date: ISODate): string {
  return v5(`${recurrenceId}:${date}`, NS_RECURRENCE);
}

export function seedCategoryId(userId: string, slug: string): string {
  return v5(`${userId}:${slug}`, NS_CATEGORY);
}

export function seedRuleId(userId: string, pattern: string): string {
  return v5(`${userId}:${pattern}`, NS_RULE);
}

export function seedReminderId(userId: string, kind: string): string {
  return v5(`${userId}:${kind}`, NS_REMINDER);
}

export function reserveGoalId(userId: string): string {
  return v5(`${userId}:emergency`, NS_GOAL);
}

export function receiptItemId(receiptId: string, lineNo: number): string {
  return v5(`${receiptId}:${lineNo}`, NS_RECEIPT_ITEM);
}

export function pluggyTxId(userId: string, externalId: string): string {
  return v5(`${userId}:${externalId}`, NS_PLUGGY_TX);
}

/** Saldo credor da fatura anterior (RN-15). */
export function carryOverTxId(prevInvoiceId: string): string {
  return v5(prevInvoiceId, NS_CARRY_OVER);
}

/** Central de avisos: idempotente por dedupe_key. */
export function noticeId(userId: string, dedupeKey: string): string {
  return v5(`${userId}:${dedupeKey}`, NS_NOTICE);
}

export function monthClosingId(userId: string, month: YearMonth): string {
  return v5(`${userId}:${month}`, NS_MONTH);
}
