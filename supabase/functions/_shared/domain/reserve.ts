// Reserva de emergência (tech §5.7, PRD RN-52..RN-56). [CONTRATO]
import { bucketBudget, type MonthInput } from './budget.ts';
import { addMonths, monthOf } from './dates.ts';
import type { BasisPoints, Cents, ISODate, Tx, YearMonth } from './types.ts';

export interface MonthlyNeeds {
  month: YearMonth;
  needsCents: Cents;
}

const ANY_CONFIG = {
  pctBp: { needs: 5000, wants: 3000, savings: 2000 },
  alertThresholdsBp: [10000],
};

function effective(tx: Tx, today: ISODate): boolean {
  return (
    tx.deletedAt === null &&
    tx.status !== 'cancelled' &&
    (tx.reviewState === 'ok' || tx.reviewState === 'new') &&
    tx.occurredOn <= today
  );
}

/** Necessidades efetivadas por mês civil (RN-52) e o número de despesas efetivadas lançadas no mês. */
export function monthlyNeedsHistory(
  inputs: readonly MonthInput[],
): Array<MonthlyNeeds & { expenseCount: number }> {
  return inputs.map((input) => {
    const needs = bucketBudget(input, ANY_CONFIG, 0).needs.spentCents;
    const expenseCount = input.txs.filter(
      (t) =>
        t.kind === 'expense' && effective(t, input.today) && monthOf(t.occurredOn) === input.month,
    ).length;
    return { month: input.month, needsCents: needs, expenseCount };
  });
}

/** Média com arredondamento meio para cima, em centavos. */
function averageHalfUp(values: readonly number[]): number {
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.floor((2 * sum + values.length) / (2 * values.length));
}

/**
 * RN-52: factor × média (meio para cima) dos até N meses civis completos mais recentes com ≥ 5 despesas efetivadas.
 * Sem nenhum: factor × meta de Necessidades de M (provisional). Sem meta de Necessidades (Base = 0): null.
 */
export function suggestedReserveTarget(
  history: readonly (MonthlyNeeds & { expenseCount: number })[],
  currentNeedsTargetCents: Cents,
  opts: { factor: number; lookbackMonths: number },
): {
  targetCents: Cents;
  avgNeedsCents: Cents;
  basisMonths: YearMonth[];
  provisional: boolean;
} | null {
  const basis = history
    .filter((h) => h.expenseCount >= 5)
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, opts.lookbackMonths);
  if (basis.length === 0) {
    if (currentNeedsTargetCents <= 0) {
      return null;
    }
    return {
      targetCents: opts.factor * currentNeedsTargetCents,
      avgNeedsCents: currentNeedsTargetCents,
      basisMonths: [],
      provisional: true,
    };
  }
  const avgNeedsCents = averageHalfUp(basis.map((h) => h.needsCents));
  return {
    targetCents: opts.factor * avgNeedsCents,
    avgNeedsCents,
    basisMonths: basis.map((h) => h.month).sort(),
    provisional: false,
  };
}

export interface ReserveProgress {
  savedCents: Cents; // pode ser negativo (resgates acima do guardado): a UI mostra 0% com aviso
  targetCents: Cents;
  progressBp: BasisPoints;
  monthsCovered: number; // 1 casa decimal
  etaMonths: number | null;
  achieved: boolean;
}

export interface ReserveGoal {
  targetMode: 'auto' | 'manual';
  targetCents: Cents | null;
  autoFactor: number;
  autoLookbackMonths: number;
  initialSavedCents: Cents;
  id: string;
}

/**
 * RN-56: guardado = saldo inicial + aportes efetivados − resgates efetivados (todos os meses). Aporte = despesa com
 * goalId da reserva em meio imediato (RN-54); resgate = receita com goalId (RN-36).
 * progressBp = min(10000, floor(guardado × 10000 / meta)); guardado < 0 → 0. ETA pela média de aportes dos últimos
 * 3 meses completos (null com menos de 2 meses de dados ou média 0).
 */
export function reserveProgress(
  goal: ReserveGoal,
  txs: readonly Tx[],
  history: readonly MonthlyNeeds[],
  today: ISODate,
): ReserveProgress {
  let savedCents = goal.initialSavedCents;
  const contributionsByMonth = new Map<YearMonth, number>();
  for (const tx of txs) {
    if (tx.goalId !== goal.id || !effective(tx, today)) {
      continue;
    }
    if (tx.kind === 'expense' && tx.cardId === null) {
      savedCents += tx.amountCents;
      const m = monthOf(tx.occurredOn);
      contributionsByMonth.set(m, (contributionsByMonth.get(m) ?? 0) + tx.amountCents);
    } else if (tx.kind === 'income') {
      savedCents -= tx.amountCents;
    }
  }

  const recent = [...history]
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, goal.autoLookbackMonths);
  const avgNeeds = recent.length > 0 ? averageHalfUp(recent.map((h) => h.needsCents)) : 0;
  const targetCents =
    goal.targetMode === 'manual' || goal.targetCents !== null
      ? (goal.targetCents ?? 0)
      : goal.autoFactor * avgNeeds;

  const progressBp =
    targetCents > 0 && savedCents > 0
      ? Math.min(10000, Math.floor((savedCents * 10000) / targetCents))
      : 0;
  const monthsCovered =
    avgNeeds > 0 && savedCents > 0 ? Math.floor((savedCents * 10) / avgNeeds) / 10 : 0;

  const current = monthOf(today);
  const last3 = [1, 2, 3].map((k) => addMonths(current, -k));
  const firstContribution = [...contributionsByMonth.keys()].sort()[0];
  const monthsOfData = firstContribution ? last3.filter((m) => m >= firstContribution).length : 0;
  const avgContribution =
    monthsOfData >= 2
      ? Math.floor(
          last3.reduce((acc, m) => acc + (contributionsByMonth.get(m) ?? 0), 0) / monthsOfData,
        )
      : 0;
  let etaMonths: number | null = null;
  if (savedCents >= targetCents && targetCents > 0) {
    etaMonths = 0;
  } else if (avgContribution > 0) {
    etaMonths = Math.ceil((targetCents - savedCents) / avgContribution);
  }

  return {
    savedCents,
    targetCents,
    progressBp,
    monthsCovered,
    etaMonths,
    achieved: targetCents > 0 && savedCents >= targetCents,
  };
}
