// Tipos base do domínio (tech §5.1, [CONTRATO]).
export type Cents = number; // inteiro seguro; >= 0 salvo onde dito
export type BasisPoints = number; // 10000 = 100%
export type ISODate = string; // 'YYYY-MM-DD'
export type YearMonth = string; // 'YYYY-MM'
export type Bucket = 'needs' | 'wants' | 'savings';
export type CategoryBucket = Bucket | 'income' | 'transfer' | 'none';
export type TxKind = 'expense' | 'income' | 'transfer' | 'refund' | 'adjust_in' | 'adjust_out';
export type PaymentMethod =
  | 'pix'
  | 'debit'
  | 'credit'
  | 'cash'
  | 'meal_voucher'
  | 'food_voucher'
  | 'transfer'
  | 'boleto'
  | 'auto_debit'
  | 'other';
export type TxSource =
  | 'manual'
  | 'pluggy'
  | 'ofx'
  | 'csv'
  | 'nfce'
  | 'recurrence'
  | 'installment'
  | 'system';
export type ReviewState = 'ok' | 'new' | 'suggested' | 'merged' | 'ignored';
export type MonthStatus = 'on_track' | 'attention' | 'over' | 'no_income'; // selo da RN-50

export interface Tx {
  id: string;
  kind: TxKind;
  status: 'posted' | 'pending' | 'cancelled';
  countBeforeReceived: boolean;
  invoicePinned: boolean;
  amountCents: Cents;
  occurredOn: ISODate;
  description: string | null;
  categoryId: string | null;
  paymentMethod: PaymentMethod;
  accountId: string | null;
  cardId: string | null;
  invoiceId: string | null;
  counterpartAccountId: string | null;
  counterpartCardId: string | null;
  seriesId: string | null;
  installmentNumber: number | null;
  installmentCount: number | null;
  recurrenceId: string | null;
  recurrenceDate: ISODate | null;
  goalId: string | null;
  incomeExpected: boolean;
  source: TxSource;
  externalId: string | null;
  reviewState: ReviewState;
  duplicateOf: string | null;
  merchantCnpj: string | null;
  deletedAt: string | null;
}

export interface Card {
  id: string;
  closingDay: number;
  dueDay: number;
  closingDayRule: 'next' | 'same';
  limitCents: Cents | null;
  paymentAccountId: string | null;
}

export interface Account {
  id: string;
  type: string;
  isRestricted: boolean;
  includeInSpendable: boolean;
  initialBalanceCents: number;
  initialBalanceOn: ISODate;
}

export interface Category {
  id: string;
  parentId: string | null;
  kind: 'expense' | 'income' | 'transfer';
  bucket: CategoryBucket;
  slug: string | null;
  feedsReserve: boolean;
  isSystem: boolean;
}

/** Relógio e gerador de ids injetados na borda (o domínio não lê o relógio nem sorteia). */
export interface DomainCtx {
  today: ISODate;
  newId: () => string;
}
