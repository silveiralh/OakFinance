// "Quanto ainda posso gastar" (tech §5.6, PRD RN-47..RN-51). [CONTRATO]
// Disponível(M) = Base + Resgates − GR − CP − AporteRestante, em centavos inteiros e sem dupla contagem.
import {
  type BudgetConfig,
  budgetMonthOf,
  type CardAttribution,
  type IncomeBreakdown,
  isPredicted,
  type MonthInput,
  monthlyIncome,
} from './budget.ts';
import { addMonths, clampDay, daysInMonth, diffDays, monthOf } from './dates.ts';
import { invoiceTotals } from './invoices.ts';
import { applyBp } from './money.ts';
import { projectRecurrences } from './recurrence.ts';
import type { Account, Cents, ISODate, MonthStatus, Tx, YearMonth } from './types.ts';

export interface SpendableConfig {
  includeExpectedIncome: boolean; // padrão true: respeita o "Contar antes de receber" de cada receita (RN-33)
  savingsMode: 'target' | 'none'; // padrão 'target' (usa pctBp.savings do orçamento)
  includeUpcoming: boolean; // padrão true; false = não desconta aVencer (S06 do UX)
  cardAttribution: CardAttribution; // padrão 'invoice_due_month'
  includeRestrictedAccounts: boolean; // padrão true (RN-35)
}

export const DEFAULT_SPENDABLE_CONFIG: Readonly<SpendableConfig> = {
  includeExpectedIncome: true,
  savingsMode: 'target',
  includeUpcoming: true,
  cardAttribution: 'invoice_due_month',
  includeRestrictedAccounts: true,
};

export interface SpendableBreakdown {
  month: YearMonth;
  today: ISODate;
  income: IncomeBreakdown & { totalCents: Cents };
  withdrawalsCents: Cents;
  spentCents: Cents;
  upcoming: { cardCents: Cents; recurringCents: Cents; scheduledCents: Cents; totalCents: Cents };
  savingsReserveCents: Cents;
  savingsDoneCents: Cents;
  availableCents: number; // pode ser negativo
  daysLeft: number; // inclui hoje
  perDayCents: number; // floor(available / daysLeft); 0 se available ≤ 0
  status: MonthStatus;
  futureCardCents: Cents; // RN-49: faturas com vencimento após M
}

function counts(tx: Tx): boolean {
  return (
    tx.deletedAt === null &&
    tx.status !== 'cancelled' &&
    (tx.reviewState === 'ok' || tx.reviewState === 'new')
  );
}

/** RN-50: on_track se Disponível × 100 ≥ Base × 20; attention se ≥ 0; over se < 0; no_income se Base = 0. */
export function monthStatus(availableCents: number, baseCents: Cents): MonthStatus {
  if (baseCents <= 0) {
    return 'no_income';
  }
  if (availableCents < 0) {
    return 'over';
  }
  return availableCents * 100 >= baseCents * 20 ? 'on_track' : 'attention';
}

/** Dias de hoje até o último dia de M, inclusive (RN-48). */
export function daysLeftInMonth(month: YearMonth, today: ISODate): number {
  const last = clampDay(month, daysInMonth(month));
  const first = clampDay(month, 1);
  const from = today < first ? first : today;
  return Math.max(0, diffDays(from, last) + 1);
}

export function spendableThisMonth(
  input: MonthInput,
  budget: BudgetConfig,
  config: SpendableConfig,
): SpendableBreakdown {
  const view: MonthInput = {
    ...input,
    attribution: config.cardAttribution,
    includeRestrictedAccounts: config.includeRestrictedAccounts,
  };
  const income = monthlyIncome(view, { includeExpected: config.includeExpectedIncome });
  const restricted = new Set(input.accounts.filter((a) => a.isRestricted).map((a) => a.id));
  const savingsCats = new Set(
    input.categories.filter((c) => c.bucket === 'savings').map((c) => c.id),
  );
  const caixa = config.cardAttribution === 'invoice_due_month';

  // Fatura paga = havia o que pagar e os pagamentos cobriram (RN-14); calculada uma vez por fatura
  const paidCache = new Map<string, boolean>();
  const isPaid = (invoiceId: string) => {
    let paid = paidCache.get(invoiceId);
    if (paid === undefined) {
      const t = invoiceTotals(invoiceId, input.txs);
      paid = t.chargesCents - t.creditsCents > 0 && t.balanceCents <= 0;
      paidCache.set(invoiceId, paid);
    }
    return paid;
  };

  let withdrawalsCents = 0;
  let spentCents = 0;
  let cardCents = 0;
  let scheduledCents = 0;
  let savingsDoneCents = 0;
  let futureCardCents = 0;

  for (const tx of input.txs) {
    if (!counts(tx)) {
      continue;
    }
    if (tx.kind === 'income') {
      if (tx.goalId !== null && monthOf(tx.occurredOn) === input.month) {
        withdrawalsCents += tx.amountCents; // RN-36: soma no painel, fora da Base
      }
      continue;
    }
    if (tx.kind !== 'expense' && tx.kind !== 'refund') {
      continue; // transferências e pagamentos de fatura nunca contam (RN-04)
    }
    if (
      !config.includeRestrictedAccounts &&
      tx.accountId !== null &&
      restricted.has(tx.accountId)
    ) {
      continue; // RN-35
    }
    const sign = tx.kind === 'refund' ? -1 : 1;
    const month = budgetMonthOf(tx, input.invoiceMonthById, config.cardAttribution);
    if (month !== input.month) {
      if (caixa && tx.cardId !== null && month > input.month) {
        futureCardCents += sign * tx.amountCents; // RN-49
      }
      continue;
    }
    let realized: boolean;
    if (tx.cardId !== null) {
      realized = caixa
        ? tx.invoiceId !== null && isPaid(tx.invoiceId)
        : !isPredicted(tx, input.today, input.invoiceMonthById);
      if (!realized) {
        cardCents += sign * tx.amountCents;
      }
    } else {
      realized = tx.occurredOn <= input.today;
      if (!realized) {
        scheduledCents += sign * tx.amountCents;
      }
    }
    if (realized) {
      spentCents += sign * tx.amountCents;
      if (tx.categoryId !== null && savingsCats.has(tx.categoryId)) {
        savingsDoneCents += sign * tx.amountCents;
      }
    }
  }

  // Recorrências de despesa projetadas/atrasadas e não realizadas com mês de impacto M
  let recurringCents = 0;
  const first = clampDay(input.month, 1);
  const prevFirst = clampDay(addMonths(input.month, -1), 1);
  const expenseRecs = input.recurrences.filter(
    (r) =>
      r.kind === 'expense' &&
      (config.includeRestrictedAccounts || r.accountId === null || !restricted.has(r.accountId)),
  );
  for (const occ of projectRecurrences(
    expenseRecs,
    { from: caixa ? prevFirst : first, to: clampDay(input.month, daysInMonth(input.month)) },
    input.txs,
    input.cards,
  )) {
    if (occ.realizedTxId !== null) {
      continue;
    }
    const month =
      caixa && occ.invoiceReferenceMonth !== null ? occ.invoiceReferenceMonth : monthOf(occ.date);
    if (month === input.month) {
      recurringCents += occ.amountCents;
    }
  }

  const upcomingTotal = cardCents + recurringCents + scheduledCents;
  const target =
    config.savingsMode === 'target' && income.totalCents > 0
      ? applyBp(income.totalCents, budget.pctBp.savings)
      : 0;
  const savingsReserveCents = Math.max(target - savingsDoneCents, 0);
  const availableCents =
    income.totalCents +
    withdrawalsCents -
    spentCents -
    (config.includeUpcoming ? upcomingTotal : 0) -
    savingsReserveCents;
  const daysLeft = daysLeftInMonth(input.month, input.today);
  return {
    month: input.month,
    today: input.today,
    income,
    withdrawalsCents,
    spentCents,
    upcoming: { cardCents, recurringCents, scheduledCents, totalCents: upcomingTotal },
    savingsReserveCents,
    savingsDoneCents,
    availableCents,
    daysLeft,
    perDayCents: availableCents > 0 && daysLeft > 0 ? Math.floor(availableCents / daysLeft) : 0,
    status: monthStatus(availableCents, income.totalCents),
    futureCardCents: caixa ? futureCardCents : 0,
  };
}

/** Saldo das contas restritas (VR/VA) até `asOf`: saldo inicial + entradas − saídas. */
export function restrictedBalances(
  accounts: readonly Account[],
  txs: readonly Tx[],
  asOf: ISODate,
): Array<{ accountId: string; balanceCents: number }> {
  return accounts
    .filter((a) => a.isRestricted)
    .map((a) => {
      let balance = a.initialBalanceOn <= asOf ? a.initialBalanceCents : 0;
      for (const tx of txs) {
        if (!counts(tx) || tx.occurredOn > asOf || tx.occurredOn < a.initialBalanceOn) {
          continue;
        }
        if (tx.accountId === a.id) {
          balance +=
            tx.kind === 'income' || tx.kind === 'refund' || tx.kind === 'adjust_in'
              ? tx.amountCents
              : -tx.amountCents;
        } else if (tx.kind === 'transfer' && tx.counterpartAccountId === a.id) {
          balance += tx.amountCents;
        }
      }
      return { accountId: a.id, balanceCents: balance };
    });
}
