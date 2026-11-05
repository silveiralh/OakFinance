// Faturas do cartão (tech §5.2, PRD RN-09..RN-19). [CONTRATO]
// A fatura é identificada pelo mês do VENCIMENTO (referenceMonth, RN-13).
import { addDays, addMonths, clampDay, monthOf } from './dates.ts';
import { carryOverTxId, invoiceId } from './ids.ts';
import type { Card, Cents, DomainCtx, ISODate, Tx, YearMonth } from './types.ts';

export interface InvoiceDates {
  referenceMonth: YearMonth;
  closingDate: ISODate;
  dueDate: ISODate;
}

export interface InvoicePeriod extends InvoiceDates {
  id: string;
  cardId: string;
  periodStart: ISODate;
  periodEnd: ISODate;
}

export type InvoiceStatus = 'future' | 'open' | 'closed' | 'paid' | 'partial' | 'overdue';

export interface InvoiceTotals {
  chargesCents: Cents;
  creditsCents: Cents;
  paymentsCents: Cents;
  balanceCents: number; // pode ser < 0 (saldo credor)
}

/** Datas calculadas do mês de referência M, ou as informadas (manuais/Pluggy), que substituem as calculadas. */
function datesOf(card: Card, m: YearMonth, overrides: readonly InvoiceDates[]): InvoiceDates {
  const override = overrides.find((o) => o.referenceMonth === m);
  if (override) {
    return override;
  }
  const dueDate = clampDay(m, card.dueDay); // RN-11
  const closingDate =
    card.closingDay < card.dueDay
      ? clampDay(m, card.closingDay)
      : clampDay(addMonths(m, -1), card.closingDay); // RN-10
  return { referenceMonth: m, closingDate, dueDate };
}

/**
 * Período da fatura M (RN-13). Regra 'next': [fech(M−1), fech(M) − 1]. Regra 'same': [fech(M−1) + 1, fech(M)].
 * Datas manuais de um mês ajustam os vizinhos.
 */
export function invoicePeriod(
  card: Card,
  referenceMonth: YearMonth,
  overrides: readonly InvoiceDates[] = [],
): InvoicePeriod {
  const own = datesOf(card, referenceMonth, overrides);
  const prev = datesOf(card, addMonths(referenceMonth, -1), overrides);
  const same = card.closingDayRule === 'same';
  return {
    id: invoiceId(card.id, referenceMonth),
    cardId: card.id,
    referenceMonth,
    closingDate: own.closingDate,
    dueDate: own.dueDate,
    periodStart: same ? addDays(prev.closingDate, 1) : prev.closingDate,
    periodEnd: same ? own.closingDate : addDays(own.closingDate, -1),
  };
}

/**
 * Fatura de uma compra (RN-12): a menor M com p < fech(M) (regra 'next', compra no dia do fechamento vai para a
 * seguinte) ou p ≤ fech(M) (regra 'same').
 */
export function invoiceForPurchase(
  card: Card,
  purchaseDate: ISODate,
  overrides: readonly InvoiceDates[] = [],
): InvoicePeriod {
  const m0 = monthOf(purchaseDate);
  for (let k = -1; k <= 3; k++) {
    const m = addMonths(m0, k);
    const { closingDate } = datesOf(card, m, overrides);
    const inside =
      card.closingDayRule === 'same' ? purchaseDate <= closingDate : purchaseDate < closingDate;
    if (inside) {
      return invoicePeriod(card, m, overrides);
    }
  }
  // Inalcançável com datas coerentes: o fechamento de M+2 sempre é posterior a qualquer dia de M.
  return invoicePeriod(card, addMonths(m0, 4), overrides);
}

/** Fatura aberta hoje: a que receberia uma compra feita hoje. */
export function currentOpenInvoice(
  card: Card,
  today: ISODate,
  overrides: readonly InvoiceDates[] = [],
): InvoicePeriod {
  return invoiceForPurchase(card, today, overrides);
}

/** Melhor dia de compra = dia do fechamento (RN-09). */
export function bestPurchaseDay(card: Card): number {
  return card.closingDay;
}

/** Itens que contam: não excluídos, não cancelados e não pendentes de revisão de duplicidade (tech §3.0). */
export function countsForTotals(tx: Tx): boolean {
  return (
    tx.deletedAt === null &&
    tx.status !== 'cancelled' &&
    (tx.reviewState === 'ok' || tx.reviewState === 'new')
  );
}

/** charges: despesas no cartão; credits: estornos no cartão; payments: transferências para o cartão (RN-15/RN-16). */
export function invoiceTotals(id: string, txs: readonly Tx[]): InvoiceTotals {
  let chargesCents = 0;
  let creditsCents = 0;
  let paymentsCents = 0;
  for (const tx of txs) {
    if (tx.invoiceId !== id || !countsForTotals(tx)) {
      continue;
    }
    if (tx.kind === 'expense' && tx.cardId !== null) {
      chargesCents += tx.amountCents;
    } else if (tx.kind === 'refund' && tx.cardId !== null) {
      creditsCents += tx.amountCents;
    } else if (tx.kind === 'transfer' && tx.counterpartCardId !== null) {
      paymentsCents += tx.amountCents;
    }
  }
  return {
    chargesCents,
    creditsCents,
    paymentsCents,
    balanceCents: chargesCents - creditsCents - paymentsCents,
  };
}

/**
 * Status calculado (RN-14), em ordem: paid → partial → overdue → closed → open → future.
 * Fatura com saldo ≤ 0 depois do fechamento ("sem valor a pagar") conta como paid; antes do fechamento, só é paid
 * quando havia o que pagar e os pagamentos cobriram tudo.
 */
export function invoiceStatus(
  p: InvoicePeriod,
  totals: InvoiceTotals,
  today: ISODate,
): InvoiceStatus {
  const closed = today > p.periodEnd;
  const total = totals.chargesCents - totals.creditsCents;
  if (totals.balanceCents <= 0 && (closed || (total > 0 && totals.paymentsCents > 0))) {
    return 'paid';
  }
  if (totals.paymentsCents > 0 && totals.balanceCents > 0 && today <= p.dueDate) {
    return 'partial';
  }
  if (today > p.dueDate && totals.balanceCents > 0) {
    return 'overdue';
  }
  if (closed) {
    return 'closed';
  }
  if (today >= p.periodStart) {
    return 'open';
  }
  return 'future';
}

export const CARRY_OVER_DESCRIPTION = 'Saldo credor da fatura anterior';

/**
 * RN-15: fatura fechada com saldo < 0 gera na seguinte um estorno de |saldo| ("Saldo credor da fatura anterior"),
 * source 'system', id = carryOverTxId(prev.id). Idempotente: o mesmo id e o mesmo valor para os mesmos totais.
 * Devolve null quando não há saldo credor (o chamador remove o item anterior, se existir).
 */
export function carryOverCredit(
  prev: InvoicePeriod,
  totals: InvoiceTotals,
  next: InvoicePeriod,
  ctx: DomainCtx,
  saldoCredorCategoryId: string | null = null,
): Omit<Tx, 'deletedAt'> | null {
  if (ctx.today <= prev.periodEnd || totals.balanceCents >= 0) {
    return null;
  }
  return {
    id: carryOverTxId(prev.id),
    kind: 'refund',
    status: 'posted',
    countBeforeReceived: false,
    invoicePinned: true,
    amountCents: -totals.balanceCents,
    occurredOn: next.periodStart,
    description: CARRY_OVER_DESCRIPTION,
    categoryId: saldoCredorCategoryId,
    paymentMethod: 'credit',
    accountId: null,
    cardId: next.cardId,
    invoiceId: next.id,
    counterpartAccountId: null,
    counterpartCardId: null,
    seriesId: null,
    installmentNumber: null,
    installmentCount: null,
    recurrenceId: null,
    recurrenceDate: null,
    goalId: null,
    incomeExpected: false,
    source: 'system',
    externalId: null,
    reviewState: 'ok',
    duplicateOf: null,
    merchantCnpj: null,
  };
}

/** Faturas que faltam entre `from` e `to` (inclusive), para criar com o id v5. */
export function ensureInvoices(
  card: Card,
  from: YearMonth,
  to: YearMonth,
  existing: readonly InvoiceDates[],
): InvoicePeriod[] {
  const out: InvoicePeriod[] = [];
  const have = new Set(existing.map((e) => e.referenceMonth));
  for (let m = from; m <= to; m = addMonths(m, 1)) {
    if (!have.has(m)) {
      out.push(invoicePeriod(card, m, existing));
    }
  }
  return out;
}

/** Limite disponível = limite − (compras − estornos − pagamentos) ainda em aberto no cartão. Pode ficar negativo. */
export function cardAvailableLimit(card: Card, txs: readonly Tx[]): Cents | null {
  if (card.limitCents === null) {
    return null;
  }
  let used = 0;
  for (const tx of txs) {
    if (!countsForTotals(tx)) {
      continue;
    }
    if (tx.cardId === card.id && tx.kind === 'expense') {
      used += tx.amountCents;
    } else if (tx.cardId === card.id && tx.kind === 'refund') {
      used -= tx.amountCents;
    } else if (tx.kind === 'transfer' && tx.counterpartCardId === card.id) {
      used -= tx.amountCents;
    }
  }
  return card.limitCents - used;
}

export interface InvoiceReassignment {
  txId: string;
  fromInvoiceId: string | null;
  toInvoiceId: string;
  toReferenceMonth: YearMonth;
}

/**
 * RN-17/RN-18: ao mudar F, V ou a regra do cartão, recalcula a fatura só dos itens em faturas abertas ou futuras
 * (período ainda não terminou) e sem `invoicePinned`. Parcela k vai para (fatura da compra + k − 1).
 * Devolve só os itens que mudam de fatura (a prévia "X itens vão mudar de fatura").
 */
export function reassignCardItems(
  oldCard: Card,
  newCard: Card,
  txs: readonly Tx[],
  today: ISODate,
  overrides: readonly InvoiceDates[] = [],
): InvoiceReassignment[] {
  const out: InvoiceReassignment[] = [];
  for (const tx of txs) {
    if (
      tx.cardId !== oldCard.id ||
      tx.invoicePinned ||
      tx.deletedAt !== null ||
      (tx.kind !== 'expense' && tx.kind !== 'refund')
    ) {
      continue;
    }
    const shift = (tx.installmentNumber ?? 1) - 1;
    const before = invoicePeriod(
      oldCard,
      addMonths(invoiceForPurchase(oldCard, tx.occurredOn, overrides).referenceMonth, shift),
      overrides,
    );
    if (today > before.periodEnd) {
      continue; // fatura já fechada (ou paga/vencida): não muda
    }
    const month = addMonths(
      invoiceForPurchase(newCard, tx.occurredOn, overrides).referenceMonth,
      shift,
    );
    const target = invoiceId(newCard.id, month);
    if (target !== tx.invoiceId) {
      out.push({
        txId: tx.id,
        fromInvoiceId: tx.invoiceId,
        toInvoiceId: target,
        toReferenceMonth: month,
      });
    }
  }
  return out;
}
