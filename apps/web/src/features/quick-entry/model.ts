// Regras puras do lançamento rápido (Q01, US-12, US-17): sugestões de categoria, meios de pagamento a partir das
// contas e cartões, o que falta para lançar e a linha da despesa.
import { addDays, type ISODate } from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';
import { accountMethods } from '../../data/repositories/accounts';
import { type MessageKey, t } from '../../i18n/pt-BR';
import type { MethodKind, PaymentMethodOption } from '../../ui';

/** Sem histórico (US-12): Mercado, Restaurantes e delivery, Transporte, Combustível e Farmácia. */
export const DEFAULT_SUGGESTION_SLUGS = [
  'mercado',
  'restaurantes-delivery',
  'transporte',
  'combustivel',
  'farmacia',
] as const;

export const SUGGESTIONS = 5;
export const FREQUENCY_DAYS = 30;

type Category = LocalRow<'categories'>;
type Tx = LocalRow<'transactions'>;

/** Categorias de despesa que aparecem no seletor (sem sistema, arquivadas ou excluídas). */
export function expenseCategories(categories: readonly Category[]): Category[] {
  return categories.filter(
    (c) => c.kind === 'expense' && !c.is_system && c.archived_at === null && c.deleted_at === null,
  );
}

/**
 * 5 sugestões (UX §3 Q01): as mais frequentes nos últimos 30 dias e, completando, as padrão. A regra aprendida por
 * meio e horário (item a) entra com a categorização (T-041/RN-61).
 */
export function suggestCategories(
  categories: readonly Category[],
  recent: readonly Tx[],
  today: ISODate,
): Category[] {
  const selectable = expenseCategories(categories);
  const byId = new Map(selectable.map((c) => [c.id, c]));
  const since = addDays(today, -FREQUENCY_DAYS);
  const counts = new Map<string, number>();
  for (const tx of recent) {
    if (
      tx.kind === 'expense' &&
      tx.deleted_at === null &&
      tx.category_id &&
      byId.has(tx.category_id) &&
      tx.occurred_on >= since &&
      tx.occurred_on <= today
    ) {
      counts.set(tx.category_id, (counts.get(tx.category_id) ?? 0) + 1);
    }
  }
  const frequent = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => byId.get(id) as Category);
  const out: Category[] = [];
  const push = (c: Category | undefined) => {
    if (c && !out.some((o) => o.id === c.id) && out.length < SUGGESTIONS) {
      out.push(c);
    }
  };
  frequent.forEach(push);
  for (const slug of DEFAULT_SUGGESTION_SLUGS) {
    push(selectable.find((c) => c.slug === slug));
  }
  selectable.forEach(push);
  return out;
}

const FORM_LABEL: Record<string, MessageKey> = {
  pix: 'accounts.method.pix',
  debit: 'accounts.method.debit',
  cash: 'accounts.method.cash',
};

export interface QuickMethod extends PaymentMethodOption {
  paymentMethod: Tx['payment_method'];
}

/** Meios do lançamento: Pix e Débito de cada conta corrente, Dinheiro, VR, VA e Crédito de cada cartão. */
export function buildMethods(
  accounts: readonly LocalRow<'accounts'>[],
  cards: readonly LocalRow<'cards'>[],
): QuickMethod[] {
  const out: QuickMethod[] = [];
  for (const account of accounts) {
    if (account.deleted_at !== null || account.archived_at !== null) {
      continue;
    }
    if (account.type === 'meal_voucher' || account.type === 'food_voucher') {
      const vr = account.type === 'meal_voucher';
      out.push({
        id: `${vr ? 'vr' : 'va'}:${account.id}`,
        kind: (vr ? 'vr' : 'va') as MethodKind,
        label: account.name,
        accountId: account.id,
        paymentMethod: vr ? 'meal_voucher' : 'food_voucher',
      });
      continue;
    }
    for (const form of accountMethods(account.type)) {
      if (form !== 'pix' && form !== 'debit' && form !== 'cash') {
        continue;
      }
      out.push({
        id: `${form}:${account.id}`,
        kind: form as MethodKind,
        label:
          form === 'cash'
            ? account.name
            : t('quick.method', { forma: t(FORM_LABEL[form] as MessageKey), conta: account.name }),
        accountId: account.id,
        paymentMethod: form,
      });
    }
  }
  for (const card of cards) {
    if (card.deleted_at !== null || card.archived_at !== null) {
      continue;
    }
    out.push({
      id: `credit:${card.id}`,
      kind: 'credit',
      label: t('quick.method', { forma: t('accounts.method.credit'), conta: card.name }),
      accountId: null,
      cardId: card.id,
      paymentMethod: 'credit',
    });
  }
  return out;
}

/** O que falta para lançar (UX §3 Q01, US-12): primeiro o valor, depois a categoria. */
export function missingReason(amountCents: number, categoryId: string | null): string | null {
  if (amountCents <= 0) {
    return t('quick.missing.amount');
  }
  if (!categoryId) {
    return t('quick.missing.category');
  }
  return null;
}

export interface ExpenseInput {
  id: string;
  userId: string;
  amountCents: number;
  categoryId: string;
  method: QuickMethod;
  occurredOn: ISODate;
  invoiceId: string | null;
  nowIso: string;
}

/** Despesa efetivada de hoje (US-12): linha completa no formato do Postgres. */
export function buildExpense(input: ExpenseInput): Tx {
  return {
    id: input.id,
    user_id: input.userId,
    kind: 'expense',
    status: 'posted',
    amount_cents: input.amountCents,
    occurred_on: input.occurredOn,
    occurred_at: input.nowIso,
    description: null,
    description_raw: null,
    notes: null,
    category_id: input.categoryId,
    category_source: 'manual',
    category_rule_id: null,
    payment_method: input.method.paymentMethod,
    account_id: input.method.accountId,
    card_id: input.method.cardId ?? null,
    invoice_id: input.invoiceId,
    invoice_pinned: false,
    counterpart_account_id: null,
    counterpart_card_id: null,
    series_id: null,
    installment_number: null,
    installment_count: null,
    recurrence_id: null,
    recurrence_date: null,
    goal_id: null,
    income_expected: false,
    count_before_received: false,
    source: 'manual',
    external_id: null,
    external_meta: null,
    import_id: null,
    nfce_receipt_id: null,
    review_state: 'ok',
    duplicate_of: null,
    matched_external: false,
    merchant_cnpj: null,
    merchant_name: null,
    tags: [],
    created_at: input.nowIso,
    updated_at: input.nowIso,
    client_updated_at: input.nowIso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
}

/** Linha da fatura (id v5 do domínio) para a compra no cartão, quando ela ainda não existe. */
export function buildInvoice(
  period: {
    id: string;
    cardId: string;
    referenceMonth: string;
    closingDate: ISODate;
    dueDate: ISODate;
  },
  userId: string,
  nowIso: string,
): LocalRow<'invoices'> {
  return {
    id: period.id,
    user_id: userId,
    card_id: period.cardId,
    reference_month: `${period.referenceMonth}-01`,
    closing_date: period.closingDate,
    due_date: period.dueDate,
    is_manual_dates: false,
    external_bill_id: null,
    external_min_payment_cents: null,
    external_total_cents: null,
    notes: null,
    created_at: nowIso,
    updated_at: nowIso,
    client_updated_at: nowIso,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  };
}
