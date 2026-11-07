// Pluggy → tipos neutros (tech §6.1.6). Os schemas zod usam `passthrough`/`loose`: campos novos da API não quebram a
// leitura, e só o que o app usa é validado. Valores em reais (número) viram centavos inteiros; `date` de transação
// vira a data em America/Sao_Paulo; datas de calendário (vencimento, fechamento) usam só o `AAAA-MM-DD`.
import { z } from 'zod';
import { type ISODate, todayIn } from '../../domain/index.ts';
import type { ProviderAccount, ProviderBill, ProviderItem, ProviderTransaction } from '../types.ts';

const TIME_ZONE = 'America/Sao_Paulo';

const nullableString = z.string().nullish();
const nullableNumber = z.number().nullish();

export const PluggyItem = z.looseObject({
  id: z.string(),
  status: z.string(),
  executionStatus: nullableString,
  clientUserId: nullableString,
  consentExpiresAt: nullableString,
  lastUpdatedAt: nullableString,
  connector: z.looseObject({ id: z.number(), name: nullableString }).nullish(),
});

export const PluggyAccount = z.looseObject({
  id: z.string(),
  itemId: z.string(),
  type: z.string(),
  subtype: z.string(),
  name: nullableString,
  number: nullableString,
  balance: nullableNumber,
  creditData: z
    .looseObject({
      balanceCloseDate: nullableString,
      balanceDueDate: nullableString,
      creditLimit: nullableNumber,
      availableCreditLimit: nullableNumber,
      minimumPayment: nullableNumber,
    })
    .nullish(),
});

const installmentFields = {
  installmentNumber: nullableNumber,
  totalInstallments: nullableNumber,
  billId: nullableString,
};

export const PluggyTransaction = z.looseObject({
  id: z.string(),
  accountId: z.string(),
  date: z.string(),
  description: nullableString,
  descriptionRaw: nullableString,
  amount: z.number(),
  type: z.enum(['DEBIT', 'CREDIT']),
  status: z.string().nullish(),
  category: nullableString,
  paymentData: z.looseObject({ paymentMethod: nullableString }).nullish(),
  creditCardMetadata: z.looseObject(installmentFields).nullish(),
  ...installmentFields,
  merchant: z
    .looseObject({ name: nullableString, businessName: nullableString, cnpj: nullableString })
    .nullish(),
});

export const PluggyBill = z.looseObject({
  id: z.string(),
  dueDate: z.string(),
  totalAmount: z.number(),
  minimumPaymentAmount: nullableNumber,
});

/** Página do `/v2/transactions` (cursor em `next`). */
export const PluggyTransactionsPage = z.looseObject({
  results: z.array(z.unknown()),
  next: nullableString,
});

/** Página dos endpoints paginados por número (`/bills`, `/accounts`). */
export const PluggyPage = z.looseObject({
  results: z.array(z.unknown()),
  totalPages: z.number().int().nullish(),
  page: z.number().int().nullish(),
});

/** Reais (número da API) → centavos inteiros, com sinal. */
export function toCents(value: number): number {
  const cents = Math.round(Math.abs(value) * 100);
  return value < 0 ? -cents : cents;
}

/** "2026-11-10T00:00:00.000Z" → "2026-11-10" (data de calendário, sem trocar de fuso). */
export function calendarDate(value: string | null | undefined): ISODate | null {
  const match = value ? /^(\d{4}-\d{2}-\d{2})/.exec(value) : null;
  return match ? (match[1] as ISODate) : null;
}

/** Instante → data em America/Sao_Paulo. */
export function saoPauloDate(instant: string): ISODate {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new Error('data inválida');
  }
  return todayIn(TIME_ZONE, date);
}

/** Só os 4 últimos dígitos do número da conta ou do cartão. */
export function maskNumber(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 0 ? null : digits.slice(-4);
}

/** CNPJ com 14 dígitos; outro formato vira `null`. */
function cnpjOf(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length === 14 ? digits : null;
}

export function mapItem(raw: unknown): ProviderItem {
  const item = PluggyItem.parse(raw);
  return {
    id: item.id,
    connectorId: item.connector?.id ?? null,
    connectorName: item.connector?.name ?? null,
    status: item.status,
    executionStatus: item.executionStatus ?? null,
    clientUserId: item.clientUserId ?? null,
    consentExpiresAt: item.consentExpiresAt ?? null,
    updatedAt: item.lastUpdatedAt ?? null,
  };
}

export function mapAccount(raw: unknown): ProviderAccount {
  const account = PluggyAccount.parse(raw);
  const credit = account.creditData;
  return {
    id: account.id,
    itemId: account.itemId,
    type: account.type,
    subtype: account.subtype,
    name: account.name ?? null,
    numberMasked: maskNumber(account.number),
    balanceCents:
      account.balance === null || account.balance === undefined ? null : toCents(account.balance),
    credit: credit
      ? {
          closeDate: calendarDate(credit.balanceCloseDate),
          dueDate: calendarDate(credit.balanceDueDate),
          limitCents: credit.creditLimit == null ? null : toCents(credit.creditLimit),
          availableLimitCents:
            credit.availableCreditLimit == null ? null : toCents(credit.availableCreditLimit),
          minimumPaymentCents:
            credit.minimumPayment == null ? null : toCents(credit.minimumPayment),
        }
      : null,
  };
}

export function mapTransaction(raw: unknown): ProviderTransaction {
  const tx = PluggyTransaction.parse(raw);
  const card = tx.creditCardMetadata;
  const n = card?.installmentNumber ?? tx.installmentNumber ?? null;
  const total = card?.totalInstallments ?? tx.totalInstallments ?? null;
  const amountCents = Math.abs(toCents(tx.amount));
  if (amountCents === 0) {
    throw new Error('valor zero');
  }
  return {
    id: tx.id,
    accountId: tx.accountId,
    occurredAt: new Date(tx.date).toISOString(),
    occurredOn: saoPauloDate(tx.date),
    amountCents,
    direction: tx.type === 'DEBIT' ? 'out' : 'in',
    description: tx.description ?? null,
    descriptionRaw: tx.descriptionRaw ?? tx.description ?? null,
    status: tx.status === 'PENDING' ? 'pending' : 'posted',
    providerCategory: tx.category ?? null,
    paymentMethodRaw: tx.paymentData?.paymentMethod ?? null,
    installment:
      n !== null && total !== null && Number.isInteger(n) && Number.isInteger(total) && total > 1
        ? { n, total }
        : null,
    billId: card?.billId ?? tx.billId ?? null,
    merchantName: tx.merchant?.name ?? tx.merchant?.businessName ?? null,
    merchantCnpj: cnpjOf(tx.merchant?.cnpj),
  };
}

export function mapBill(raw: unknown): ProviderBill {
  const bill = PluggyBill.parse(raw);
  const dueDate = calendarDate(bill.dueDate);
  if (!dueDate) {
    throw new Error('vencimento inválido');
  }
  return {
    id: bill.id,
    dueDate,
    totalCents: toCents(bill.totalAmount),
    minimumPaymentCents:
      bill.minimumPaymentAmount == null ? null : toCents(bill.minimumPaymentAmount),
  };
}
