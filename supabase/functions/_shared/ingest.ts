// Tipos neutros do agregador → linhas do banco (tech §6.1.4 passo 4 e §6.1.6). Funções puras: o `pluggy-sync`
// (T-074) lê o que já existe, chama estas funções e grava. Toda escrita leva `device_id = 'server:pluggy'`.

import type { ProviderBill, ProviderTransaction } from './connectors/types.ts';
import {
  type Card,
  type Category,
  type CategoryRule,
  categorize,
  type InvoiceDates,
  type InvoicePeriod,
  type ISODate,
  invoiceForImported,
  monthOf,
  type PaymentMethod,
  pluggyTxId,
  suggestFromProvider,
  type TxKind,
  type YearMonth,
} from './domain/index.ts';

export const SERVER_DEVICE = 'server:pluggy';

/** Onde o lançamento entra: numa conta (corrente/poupança) ou num cartão. */
export type IngestTarget = { kind: 'account'; accountId: string } | { kind: 'card'; card: Card };

/** `external_meta` [CONTRATO] (tech §6.1.6). */
export interface ExternalMeta {
  provider: 'pluggy';
  providerCategory?: string;
  billId?: string;
  installment?: { n: number; total: number };
  paymentMethodRaw?: string;
  userMovedInvoice?: boolean;
}

/**
 * Sentido (tech §6.1.6): o `type` do provedor manda. Conta: saída → despesa, entrada → receita. Cartão: saída →
 * despesa, entrada → estorno (o "pagamento recebido" vira `ignored` no conciliador do aparelho, RN-71).
 */
export function txKindFor(
  tx: Pick<ProviderTransaction, 'direction'>,
  target: IngestTarget,
): TxKind {
  if (tx.direction === 'out') {
    return 'expense';
  }
  return target.kind === 'card' ? 'refund' : 'income';
}

const RAW_METHODS: Readonly<Record<string, PaymentMethod>> = {
  PIX: 'pix',
  TED: 'transfer',
  DOC: 'transfer',
  TEF: 'transfer',
  TRANSFER: 'transfer',
  BOLETO: 'boleto',
};

/** Meio (tech §6.1.6): cartão → crédito; PIX/TED/boleto pelo `paymentMethod` do provedor; senão débito. */
export function paymentMethodFor(
  tx: Pick<ProviderTransaction, 'paymentMethodRaw'>,
  target: IngestTarget,
): PaymentMethod {
  if (target.kind === 'card') {
    return 'credit';
  }
  return RAW_METHODS[(tx.paymentMethodRaw ?? '').toUpperCase()] ?? 'debit';
}

export function externalMetaOf(
  tx: ProviderTransaction,
  previous?: ExternalMeta | null,
): ExternalMeta {
  return {
    provider: 'pluggy',
    ...(tx.providerCategory ? { providerCategory: tx.providerCategory } : {}),
    ...(tx.billId ? { billId: tx.billId } : {}),
    ...(tx.installment ? { installment: { ...tx.installment } } : {}),
    ...(tx.paymentMethodRaw ? { paymentMethodRaw: tx.paymentMethodRaw } : {}),
    ...(previous?.userMovedInvoice === true ? { userMovedInvoice: true } : {}),
  };
}

/** Linha de fatura já gravada (o que a ingestão precisa dela). */
export interface InvoiceRef {
  id: string;
  card_id: string;
  reference_month: string; // 'AAAA-MM-01'
  closing_date: string;
  due_date: string;
  external_bill_id: string | null;
  deleted_at: string | null;
}

/** Datas reais das faturas já gravadas, para a RN-12 respeitar fechamento/vencimento ajustados. */
export function invoiceOverrides(invoices: readonly InvoiceRef[]): InvoiceDates[] {
  return invoices
    .filter((inv) => inv.deleted_at === null)
    .map((inv) => ({
      referenceMonth: inv.reference_month.slice(0, 7) as YearMonth,
      closingDate: inv.closing_date as ISODate,
      dueDate: inv.due_date as ISODate,
    }));
}

/**
 * Fatura de um item do cartão (RN-19, tech §6.1.4): com `billId`, a fatura do banco — a gravada com esse
 * `external_bill_id` ou a do mês do vencimento da bill — e `invoice_pinned`; sem, a RN-12 pela data da compra.
 */
export function invoiceForProviderTx(
  card: Card,
  tx: Pick<ProviderTransaction, 'occurredOn' | 'billId'>,
  invoices: readonly InvoiceRef[],
  bills: readonly ProviderBill[],
): { invoice: InvoicePeriod; invoicePinned: boolean; existingId: string | null } {
  const own = invoices.filter((inv) => inv.card_id === card.id && inv.deleted_at === null);
  const overrides = invoiceOverrides(own);
  const byBill = tx.billId ? own.find((inv) => inv.external_bill_id === tx.billId) : undefined;
  const bill = tx.billId ? bills.find((b) => b.id === tx.billId) : undefined;
  const bankMonth: YearMonth | null = byBill
    ? (byBill.reference_month.slice(0, 7) as YearMonth)
    : bill
      ? monthOf(bill.dueDate)
      : null;
  const { invoice, invoicePinned } = invoiceForImported(card, tx.occurredOn, bankMonth, overrides);
  const existing =
    byBill ?? own.find((inv) => inv.reference_month.slice(0, 7) === invoice.referenceMonth);
  return { invoice, invoicePinned, existingId: existing?.id ?? null };
}

/** Linha nova de fatura (id v5 por cartão e mês), quando a ingestão precisa de uma que ainda não existe. */
export function invoiceRow(
  userId: string,
  invoice: InvoicePeriod,
  nowIso: string,
  bill?: ProviderBill,
): Record<string, unknown> {
  return {
    id: invoice.id,
    user_id: userId,
    card_id: invoice.cardId,
    reference_month: `${invoice.referenceMonth}-01`,
    closing_date: invoice.closingDate,
    due_date: bill?.dueDate ?? invoice.dueDate,
    is_manual_dates: false,
    external_bill_id: bill?.id ?? null,
    external_total_cents: bill?.totalCents ?? null,
    external_min_payment_cents: bill?.minimumPaymentCents ?? null,
    client_updated_at: nowIso,
    device_id: SERVER_DEVICE,
  };
}

export interface CategoryPick {
  categoryId: string | null;
  categorySource: 'rule' | 'provider' | 'none';
  ruleId: string | null;
}

/** Categoria sugerida (tech §6.1.4): regras do usuário; senão o mapa de categorias do provedor; senão nenhuma. */
export function categoryFor(
  tx: ProviderTransaction,
  target: IngestTarget,
  rules: readonly CategoryRule[],
  categories: readonly Category[],
): CategoryPick {
  const kind = txKindFor(tx, target);
  const byRule = categorize(
    {
      description: tx.description,
      merchantCnpj: tx.merchantCnpj,
      paymentMethod: paymentMethodFor(tx, target),
      kind,
      accountId: target.kind === 'account' ? target.accountId : null,
      cardId: target.kind === 'card' ? target.card.id : null,
    },
    rules,
    categories,
  );
  if (byRule) {
    return { categoryId: byRule.categoryId, categorySource: 'rule', ruleId: byRule.ruleId };
  }
  const byProvider = suggestFromProvider(tx.providerCategory, categories);
  return byProvider
    ? { categoryId: byProvider, categorySource: 'provider', ruleId: null }
    : { categoryId: null, categorySource: 'none', ruleId: null };
}

export interface NewTxInput {
  userId: string;
  tx: ProviderTransaction;
  target: IngestTarget;
  category: CategoryPick;
  /** Obrigatória no cartão. */
  invoice: { id: string; pinned: boolean } | null;
  /** RN-80: o que é anterior ao início do uso (onboarding) entra revisado. */
  startedOn: ISODate | null;
  nowIso: string;
}

/** Linha nova de `transactions` para um item do provedor (tech §6.1.4 passo 4, "novo"). */
export function newTransactionRow(input: NewTxInput): Record<string, unknown> {
  const { tx, target } = input;
  if (target.kind === 'card' && input.invoice === null) {
    throw new Error('item de cartão sem fatura');
  }
  const reviewed = input.startedOn !== null && tx.occurredOn < input.startedOn;
  return {
    id: pluggyTxId(input.userId, tx.id),
    user_id: input.userId,
    kind: txKindFor(tx, target),
    status: tx.status,
    amount_cents: tx.amountCents,
    occurred_on: tx.occurredOn,
    occurred_at: tx.occurredAt,
    description: tx.description ? tx.description.slice(0, 200) : null,
    description_raw: tx.descriptionRaw,
    category_id: input.category.categoryId,
    category_source: input.category.categorySource,
    category_rule_id: input.category.ruleId,
    payment_method: paymentMethodFor(tx, target),
    account_id: target.kind === 'account' ? target.accountId : null,
    card_id: target.kind === 'card' ? target.card.id : null,
    invoice_id: input.invoice?.id ?? null,
    invoice_pinned: input.invoice?.pinned ?? false,
    installment_number: tx.installment?.n ?? null,
    installment_count: tx.installment?.total ?? null,
    source: 'pluggy',
    external_id: tx.id,
    external_meta: externalMetaOf(tx),
    review_state: reviewed ? 'ok' : 'new',
    merchant_name: tx.merchantName,
    merchant_cnpj: tx.merchantCnpj,
    client_updated_at: input.nowIso,
    device_id: SERVER_DEVICE,
  };
}

/** JSON com as chaves em ordem (o `jsonb` do Postgres reordena as chaves). */
function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Colunas que a ingestão pode mudar num lançamento já importado (tech §6.1.4 passo 4, "existente"). */
export const PROVIDER_COLUMNS = [
  'amount_cents',
  'occurred_on',
  'occurred_at',
  'status',
  'description_raw',
  'external_meta',
  'invoice_id',
  'invoice_pinned',
] as const;

/**
 * Atualização de um importado existente: **só** as colunas do provedor. Nunca categoria, notas, descrição
 * editada, `review_state` nem `duplicate_of`. `invoice_id` só muda se o usuário não moveu o item de fatura
 * (`external_meta.userMovedInvoice`). Devolve `null` quando nada mudou.
 */
export function providerPatch(
  existing: {
    amount_cents: number;
    occurred_on: string;
    occurred_at: string | null;
    status: string;
    description_raw: string | null;
    external_meta: unknown;
    invoice_id: string | null;
    invoice_pinned: boolean;
  },
  tx: ProviderTransaction,
  invoice: { id: string; pinned: boolean } | null,
  nowIso: string,
): Record<string, unknown> | null {
  const previous = (existing.external_meta ?? null) as ExternalMeta | null;
  const moved = previous?.userMovedInvoice === true;
  const next: Record<string, unknown> = {
    amount_cents: tx.amountCents,
    occurred_on: tx.occurredOn,
    occurred_at: tx.occurredAt,
    status: tx.status,
    description_raw: tx.descriptionRaw,
    external_meta: externalMetaOf(tx, previous),
    ...(invoice && !moved ? { invoice_id: invoice.id, invoice_pinned: invoice.pinned } : {}),
  };
  const changed = Object.entries(next).some(([key, value]) => {
    const before = (existing as Record<string, unknown>)[key];
    if (key === 'occurred_at') {
      return before === null || before === undefined
        ? value !== null
        : new Date(String(before)).getTime() !== new Date(String(value)).getTime();
    }
    return stable(before) !== stable(value);
  });
  return changed ? { ...next, client_updated_at: nowIso, device_id: SERVER_DEVICE } : null;
}
