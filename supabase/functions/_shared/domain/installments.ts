// Compras parceladas (tech §5.3, PRD RN-20..RN-25). As parcelas são linhas de transactions com id v5. [CONTRATO]
import { addMonths, clampDay, monthOf, parseISODate } from './dates.ts';
import { DomainError } from './errors.ts';
import { installmentTxId } from './ids.ts';
import {
  type InvoiceDates,
  type InvoiceStatus,
  invoiceForPurchase,
  invoicePeriod,
} from './invoices.ts';
import { splitEven } from './money.ts';
import type { Card, Cents, ISODate, Tx, YearMonth } from './types.ts';

export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 48;

export interface InstallmentPlanInput {
  seriesId: string;
  cardId: string | null;
  accountId: string | null;
  purchaseDate: ISODate;
  firstDueOn?: ISODate; // obrigatório se accountId
  totalCents: Cents;
  count: number;
  firstInstallmentCents?: Cents;
  startInstallment?: number; // compra já em andamento (ex.: começa na 4/10)
  description: string;
  categoryId: string | null;
}

export interface InstallmentDraft {
  id: string; // installmentTxId(seriesId, n)
  installmentNumber: number;
  installmentCount: number;
  amountCents: Cents;
  occurredOn: ISODate; // = purchaseDate (cartão) | vencimento (carnê)
  invoiceId: string | null;
  invoiceReferenceMonth: YearMonth | null;
}

export interface ReschedulePlan {
  upsert: InstallmentDraft[];
  softDelete: string[];
}

/** RN-20: informando o valor da parcela, total = parcela × n (todas iguais). */
export function totalFromInstallment(installmentCents: Cents, count: number): Cents {
  return installmentCents * count;
}

/** Valores das parcelas: RN-21 (resto na 1ª) ou 1ª informada pelo banco + resto dividido nas demais. */
export function installmentAmounts(
  totalCents: Cents,
  count: number,
  firstInstallmentCents?: Cents,
): Cents[] {
  if (!Number.isInteger(count) || count < MIN_INSTALLMENTS || count > MAX_INSTALLMENTS) {
    throw new DomainError(
      'INVALID_ARGUMENT',
      `número de parcelas fora de ${MIN_INSTALLMENTS}–${MAX_INSTALLMENTS}`,
    );
  }
  if (!Number.isSafeInteger(totalCents) || totalCents < count) {
    throw new DomainError('INVALID_AMOUNT', 'total mínimo é 1 centavo por parcela (RN-20)');
  }
  if (firstInstallmentCents === undefined) {
    return splitEven(totalCents, count, 'first');
  }
  if (
    !Number.isSafeInteger(firstInstallmentCents) ||
    firstInstallmentCents < 1 ||
    totalCents - firstInstallmentCents < count - 1
  ) {
    throw new DomainError('INVALID_AMOUNT', 'primeira parcela incompatível com o total');
  }
  return [
    firstInstallmentCents,
    ...splitEven(totalCents - firstInstallmentCents, count - 1, 'first'),
  ];
}

/**
 * RN-21/RN-22: parcela k na fatura (F1 + k − 1), onde F1 é a fatura da data da compra (RN-12).
 * Carnê/boleto (conta): parcela k vence no mesmo dia de `firstDueOn`, k − 1 meses depois. Gera de startInstallment em diante.
 */
export function buildInstallments(
  plan: InstallmentPlanInput,
  card: Card | null,
  overrides: readonly InvoiceDates[] = [],
): InstallmentDraft[] {
  const amounts = installmentAmounts(plan.totalCents, plan.count, plan.firstInstallmentCents);
  const start = plan.startInstallment ?? 1;
  if (!Number.isInteger(start) || start < 1 || start > plan.count) {
    throw new DomainError('INVALID_ARGUMENT', 'parcela inicial fora da série');
  }
  if ((plan.cardId === null) === (plan.accountId === null)) {
    throw new DomainError('INVALID_ARGUMENT', 'informe cartão ou conta (só um)');
  }
  const drafts: InstallmentDraft[] = [];
  if (plan.cardId !== null) {
    if (!card || card.id !== plan.cardId) {
      throw new DomainError('INVALID_ARGUMENT', 'cartão da série ausente');
    }
    const first = invoiceForPurchase(card, plan.purchaseDate, overrides).referenceMonth;
    for (let k = start; k <= plan.count; k++) {
      const period = invoicePeriod(card, addMonths(first, k - 1), overrides);
      drafts.push({
        id: installmentTxId(plan.seriesId, k),
        installmentNumber: k,
        installmentCount: plan.count,
        amountCents: amounts[k - 1] ?? 0,
        occurredOn: plan.purchaseDate,
        invoiceId: period.id,
        invoiceReferenceMonth: period.referenceMonth,
      });
    }
    return drafts;
  }
  if (!plan.firstDueOn) {
    throw new DomainError('INVALID_ARGUMENT', 'carnê precisa do primeiro vencimento');
  }
  const { day } = parseISODate(plan.firstDueOn);
  const firstMonth = monthOf(plan.firstDueOn);
  for (let k = start; k <= plan.count; k++) {
    drafts.push({
      id: installmentTxId(plan.seriesId, k),
      installmentNumber: k,
      installmentCount: plan.count,
      amountCents: amounts[k - 1] ?? 0,
      occurredOn: clampDay(addMonths(firstMonth, k - 1), day),
      invoiceId: null,
      invoiceReferenceMonth: null,
    });
  }
  return drafts;
}

const LOCKED: readonly InvoiceStatus[] = ['paid', 'partial'];
const CANCELLABLE: readonly InvoiceStatus[] = ['open', 'future'];

function alive(prev: readonly Tx[]): Tx[] {
  return prev.filter((t) => t.deletedAt === null);
}

/**
 * RN-24(b): mudar total, nº de parcelas, data ou cartão regenera a série inteira (mesmo seriesId), só se nenhuma
 * parcela estiver em fatura paid/partial; senão DomainError('INSTALLMENTS_LOCKED').
 */
export function rescheduleInstallments(
  prev: readonly Tx[],
  next: InstallmentPlanInput,
  card: Card | null,
  statusOf: (invoiceId: string) => InvoiceStatus,
  overrides: readonly InvoiceDates[] = [],
): ReschedulePlan {
  const current = alive(prev);
  if (current.some((t) => t.invoiceId !== null && LOCKED.includes(statusOf(t.invoiceId)))) {
    throw new DomainError(
      'INSTALLMENTS_LOCKED',
      'Algumas parcelas já estão em faturas pagas. Você pode cancelar as parcelas restantes e lançar o novo valor.',
    );
  }
  const upsert = buildInstallments(next, card, overrides);
  const keep = new Set(upsert.map((d) => d.id));
  return { upsert, softDelete: current.filter((t) => !keep.has(t.id)).map((t) => t.id) };
}

/** RN-25: ids das parcelas em faturas open/future, que passam a 'cancelled'. As demais ficam como estão. */
export function cancelRemainingInstallments(
  prev: readonly Tx[],
  statusOf: (invoiceId: string) => InvoiceStatus,
): string[] {
  return alive(prev)
    .filter(
      (t) =>
        t.status !== 'cancelled' &&
        t.invoiceId !== null &&
        CANCELLABLE.includes(statusOf(t.invoiceId)),
    )
    .map((t) => t.id);
}
