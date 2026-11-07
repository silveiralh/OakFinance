// Análise do mês no computador (US-35, RN-45, RN-46; UX §3 P01 em `lg`): gastos por categoria, faixas × meta,
// gasto acumulado por dia × ritmo ideal, comparação por categoria com o mês anterior e os 10 maiores gastos. Tudo
// com o mesmo mês orçamentário e o mesmo modo de cálculo da P01 (`monthContext`).
import {
  addMonths,
  bucketBudget,
  budgetMonthOf,
  categoryConsumption,
  clampDay,
  countsForTotals,
  daysInMonth,
  type ISODate,
  monthlyIncome,
  type YearMonth,
} from '@oakfinance/domain';
import { type HomeRows, monthContext } from '../dashboard/model';
import { BAND_NAME, BAND_ORDER } from './budget';

export interface CategorySpend {
  id: string;
  name: string;
  spentCents: number;
}

export interface BandVsTarget {
  bucket: (typeof BAND_ORDER)[number];
  name: string;
  spentCents: number;
  targetCents: number;
}

export interface DayPoint {
  day: number;
  actualCents: number;
  idealCents: number;
}

export interface CategoryCompare {
  id: string;
  name: string;
  currentCents: number;
  previousCents: number;
  diffCents: number;
}

export interface TopExpense {
  id: string;
  date: ISODate;
  description: string;
  category: string;
  amountCents: number;
}

export interface MonthAnalysis {
  month: YearMonth;
  byCategory: CategorySpend[];
  bands: BandVsTarget[];
  daily: DayPoint[];
  compare: CategoryCompare[];
  top: TopExpense[];
}

/** "Hoje" usado para um mês: o próprio hoje no mês corrente, o último dia num mês passado, o primeiro num futuro. */
export function referenceDay(month: YearMonth, today: ISODate): ISODate {
  const current = today.slice(0, 7) as YearMonth;
  if (month === current) {
    return today;
  }
  return month < current ? clampDay(month, daysInMonth(month)) : clampDay(month, 1);
}

function names(rows: HomeRows, noCategory: string): (id: string) => string {
  const byId = new Map(rows.categories.map((c) => [c.id, c.name]));
  return (id) => (id === '' ? noCategory : (byId.get(id) ?? noCategory));
}

/** Despesas efetivadas do mês orçamentário (RN-45 "já foi", RN-46), por categoria ('' = sem categoria). */
function spentByCategory(rows: HomeRows, month: YearMonth, today: ISODate): Map<string, number> {
  const { input } = monthContext(rows, referenceDay(month, today));
  const out = new Map<string, number>();
  for (const [id, c] of categoryConsumption(input)) {
    if (c.spentCents !== 0) {
      out.set(id, c.spentCents);
    }
  }
  return out;
}

export function monthAnalysis(
  rows: HomeRows,
  month: YearMonth,
  today: ISODate,
  noCategory = 'Sem categoria',
): MonthAnalysis {
  const ref = referenceDay(month, today);
  const { config, budget, input } = monthContext(rows, ref);
  const nameOf = names(rows, noCategory);
  const current = spentByCategory(rows, month, today);
  const previous = spentByCategory(rows, addMonths(month, -1), today);

  const byCategory = [...current.entries()]
    .map(([id, spentCents]) => ({ id, name: nameOf(id), spentCents }))
    .sort((a, b) => b.spentCents - a.spentCents || a.name.localeCompare(b.name, 'pt-BR'));

  const income = monthlyIncome(input, { includeExpected: config.includeExpectedIncome }).totalCents;
  const statuses = bucketBudget(input, budget, income);
  const bands = BAND_ORDER.map((bucket) => ({
    bucket,
    name: BAND_NAME[bucket],
    spentCents: statuses[bucket].spentCents,
    targetCents: statuses[bucket].targetCents,
  }));

  // gasto do dia: despesas efetivadas do mês orçamentário fora da Poupança (a reserva não é "gasto")
  const bucketOf = new Map<string, string>(input.categories.map((c) => [c.id, c.bucket]));
  const days = daysInMonth(month);
  const perDay = new Array<number>(days).fill(0);
  const expenses = input.txs.filter(
    (tx) =>
      tx.kind === 'expense' &&
      tx.status !== 'cancelled' &&
      countsForTotals(tx) &&
      !(tx.status === 'pending' && tx.occurredOn > ref) &&
      budgetMonthOf(tx, input.invoiceMonthById, input.attribution) === month,
  );
  for (const tx of expenses) {
    if (tx.categoryId !== null && bucketOf.get(tx.categoryId) === 'savings') {
      continue;
    }
    // compra no cartão de outro mês (fatura deste mês) conta no dia 1 ou no último
    const day =
      tx.occurredOn.slice(0, 7) < month
        ? 1
        : tx.occurredOn.slice(0, 7) > month
          ? days
          : Number(tx.occurredOn.slice(8, 10));
    perDay[day - 1] = (perDay[day - 1] ?? 0) + tx.amountCents;
  }
  const plan = statuses.needs.targetCents + statuses.wants.targetCents;
  let running = 0;
  const lastDay = ref.slice(0, 7) === month ? Number(ref.slice(8, 10)) : days;
  const daily = perDay.slice(0, lastDay).map((cents, i) => {
    running += cents;
    return { day: i + 1, actualCents: running, idealCents: Math.round((plan * (i + 1)) / days) };
  });

  const ids = new Set([...current.keys(), ...previous.keys()]);
  const compare = [...ids]
    .map((id) => {
      const currentCents = current.get(id) ?? 0;
      const previousCents = previous.get(id) ?? 0;
      return {
        id,
        name: nameOf(id),
        currentCents,
        previousCents,
        diffCents: currentCents - previousCents,
      };
    })
    .sort(
      (a, b) =>
        Math.abs(b.diffCents) - Math.abs(a.diffCents) || a.name.localeCompare(b.name, 'pt-BR'),
    );

  const top = expenses
    .filter((tx) => tx.status === 'posted' || tx.occurredOn <= ref)
    .sort((a, b) => b.amountCents - a.amountCents || a.occurredOn.localeCompare(b.occurredOn))
    .slice(0, 10)
    .map((tx) => ({
      id: tx.id,
      date: tx.occurredOn,
      description: tx.description ?? '',
      category: nameOf(tx.categoryId ?? ''),
      amountCents: tx.amountCents,
    }));

  return { month, byCategory, bands, daily, compare, top };
}

/** Meses do seletor: os 12 anteriores e o atual, do mais recente ao mais antigo. */
export function analysisMonths(today: ISODate): YearMonth[] {
  const current = today.slice(0, 7) as YearMonth;
  return Array.from({ length: 13 }, (_, i) => addMonths(current, -i));
}
