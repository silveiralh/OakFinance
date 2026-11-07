// Interface trocável de agregador bancário (tech §6.1.2, ADR-11) [CONTRATO]. Os tipos `Provider*` são neutros:
// centavos inteiros, `ISODate` no fuso de São Paulo e `direction: 'in' | 'out'`. O mapeamento do agregador para eles
// fica em `connectors/<provedor>/map.ts`; deles para as linhas do banco, em `_shared/ingest.ts`.
import type { ISODate } from '../domain/index.ts';

export type ProviderName = 'pluggy';

/** Status do item como o agregador informa (Pluggy: UPDATED, UPDATING, OUTDATED, LOGIN_ERROR, WAITING_USER_INPUT). */
export type ProviderItemStatus =
  | 'UPDATED'
  | 'UPDATING'
  | 'OUTDATED'
  | 'LOGIN_ERROR'
  | 'WAITING_USER_INPUT';

export interface ProviderItem {
  id: string;
  connectorId: number | null;
  connectorName: string | null;
  status: ProviderItemStatus | string;
  executionStatus: string | null;
  /** Quem criou o item (nosso `auth.uid`); `null` em item criado pela Demo do dashboard. */
  clientUserId: string | null;
  /** Instante (ISO); `null` = sem expiração. */
  consentExpiresAt: string | null;
  /** Última atualização dos dados no agregador (ISO). */
  updatedAt: string | null;
}

export type ProviderAccountType = 'BANK' | 'CREDIT';
export type ProviderAccountSubtype = 'CHECKING_ACCOUNT' | 'SAVINGS_ACCOUNT' | 'CREDIT_CARD';

export interface ProviderCreditData {
  closeDate: ISODate | null;
  dueDate: ISODate | null;
  limitCents: number | null;
  availableLimitCents: number | null;
  minimumPaymentCents: number | null;
}

export interface ProviderAccount {
  id: string;
  itemId: string;
  type: ProviderAccountType | string;
  subtype: ProviderAccountSubtype | string;
  name: string | null;
  /** Só os últimos dígitos (nunca o número completo). */
  numberMasked: string | null;
  /** Saldo com sinal, como informado. */
  balanceCents: number | null;
  credit: ProviderCreditData | null;
}

export interface ProviderTransaction {
  id: string;
  accountId: string;
  /** Instante da transação (ISO, com hora). */
  occurredAt: string;
  /** Data em America/Sao_Paulo. */
  occurredOn: ISODate;
  /** Valor absoluto, em centavos (> 0). */
  amountCents: number;
  /** `out` = saiu dinheiro (DEBIT), `in` = entrou (CREDIT). O tipo é a fonte da verdade do sentido (tech §6.1.6). */
  direction: 'in' | 'out';
  description: string | null;
  descriptionRaw: string | null;
  status: 'posted' | 'pending';
  providerCategory: string | null;
  paymentMethodRaw: string | null;
  installment: { n: number; total: number } | null;
  billId: string | null;
  merchantName: string | null;
  merchantCnpj: string | null;
}

export interface ProviderBill {
  id: string;
  dueDate: ISODate;
  totalCents: number;
  minimumPaymentCents: number | null;
}

export interface BankConnector {
  readonly provider: ProviderName;
  createConnectToken(input: {
    userId: string;
    itemId?: string;
  }): Promise<{ token: string; connectorIds: number[]; expiresAt: string }>;
  getItem(itemId: string): Promise<ProviderItem>;
  listAccounts(itemId: string): Promise<ProviderAccount[]>;
  listTransactions(
    accountId: string,
    range: { dateFrom: ISODate; dateTo?: ISODate },
  ): AsyncIterable<ProviderTransaction[]>;
  getTransactionsByIds(accountId: string, ids: string[]): Promise<ProviderTransaction[]>;
  listBills(accountId: string): Promise<ProviderBill[]>;
  requestRefresh(itemId: string): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
}

/** Erro do agregador com código estável (o `code` vira `job_runs`/`app_events`, nunca a resposta crua). */
export class ProviderError extends Error {
  override name = 'ProviderError';
  constructor(
    readonly code:
      | 'PROVIDER_AUTH'
      | 'ITEM_NOT_FOUND'
      | 'RATE_LIMITED'
      | 'PROVIDER_UNAVAILABLE'
      | 'PROVIDER_BAD_RESPONSE',
    readonly status: number | null = null,
  ) {
    super(code);
  }
}
