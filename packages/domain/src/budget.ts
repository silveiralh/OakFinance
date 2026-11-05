// Mês orçamentário, renda (Base) e 50/30/20 (tech §5.5, PRD RN-32..RN-46). [CONTRATO]
import { addMonths, clampDay, daysInMonth, monthOf } from './dates.ts';
import { applyBp } from './money.ts';
import { projectRecurrences, type Recurrence } from './recurrence.ts';
import type {
  Account,
  BasisPoints,
  Bucket,
  Card,
  Category,
  Cents,
  ISODate,
  Tx,
  YearMonth,
} from './types.ts';

export type CardAttribution = 'invoice_due_month' | 'purchase_month';

/** Slug da categoria de receita "Benefícios (VR/VA)" (tech §3.8). */
export const BENEFITS_SLUG = 'beneficios';
export const BUCKETS: readonly Bucket[] = ['needs', 'wants', 'savings'];
export const DEFAULT_PCT_BP: Readonly<Record<Bucket, BasisPoints>> = {
  needs: 5000,
  wants: 3000,
  savings: 2000,
};
export const DEFAULT_THRESHOLDS_BP: readonly BasisPoints[] = [8000, 10000];

/**
 * Mês de impacto (RN-46). Sem cartão: mês da data. Cartão + invoice_due_month ("caixa", padrão): mês do vencimento da
 * fatura. Cartão + purchase_month ("competência"): mês da compra + (k − 1) para a parcela k.
 */
export function budgetMonthOf(
  tx: Tx,
  invoiceMonthById: ReadonlyMap<string, YearMonth>,
  attribution: CardAttribution,
): YearMonth {
  const own = monthOf(tx.occurredOn);
  if (tx.cardId === null) {
    return own;
  }
  if (attribution === 'invoice_due_month' && tx.invoiceId !== null) {
    return invoiceMonthById.get(tx.invoiceId) ?? own;
  }
  return addMonths(own, (tx.installmentNumber ?? 1) - 1);
}

export interface MonthInput {
  month: YearMonth;
  today: ISODate;
  txs: readonly Tx[];
  recurrences: readonly Recurrence[];
  cards: readonly Card[];
  accounts: readonly Account[];
  categories: readonly Category[];
  invoiceMonthById: ReadonlyMap<string, YearMonth>;
  attribution: CardAttribution;
  includeRestrictedAccounts: boolean;
}

export interface IncomeBreakdown {
  fixedCents: Cents;
  variableReceivedCents: Cents;
  variableExpectedCents: Cents;
}

function monthRange(m: YearMonth): { from: ISODate; to: ISODate } {
  return { from: clampDay(m, 1), to: clampDay(m, daysInMonth(m)) };
}

function counts(tx: Tx): boolean {
  return (
    tx.deletedAt === null &&
    tx.status !== 'cancelled' &&
    (tx.reviewState === 'ok' || tx.reviewState === 'new')
  );
}

interface Lookup {
  category: (id: string | null) => Category | undefined;
  restricted: (accountId: string | null) => boolean;
}

function lookup(input: MonthInput): Lookup {
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  const restricted = new Set(input.accounts.filter((a) => a.isRestricted).map((a) => a.id));
  return {
    category: (id) => (id === null ? undefined : cats.get(id)),
    restricted: (accountId) => accountId !== null && restricted.has(accountId),
  };
}

/** Receita de benefício (VR/VA): categoria "Benefícios" ou destino numa conta restrita (RN-35). */
function isBenefitIncome(l: Lookup, categoryId: string | null, accountId: string | null): boolean {
  return l.category(categoryId)?.slug === BENEFITS_SLUG || l.restricted(accountId);
}

/**
 * Base(M) da RN-38. fixed: ocorrências de receitas fixas no mês (valor real se confirmada, senão o previsto; canceladas
 * saem). variableReceived: receitas avulsas recebidas. variableExpected: "Prevista" (contar antes de receber), que soma
 * quando `includeExpected`. "A receber", resgates da reserva e transferências nunca entram. Benefícios só com RN-35 ligada.
 */
export function monthlyIncome(
  input: MonthInput,
  opts: { includeExpected: boolean } = { includeExpected: true },
): IncomeBreakdown & { totalCents: Cents } {
  const l = lookup(input);
  const range = monthRange(input.month);
  const fixedIds = new Set(
    input.recurrences.filter((r) => r.isFixedIncome && r.kind === 'income').map((r) => r.id),
  );
  const benefitsOk = (categoryId: string | null, accountId: string | null) =>
    input.includeRestrictedAccounts || !isBenefitIncome(l, categoryId, accountId);

  let fixedCents = 0;
  const fixedRecs = input.recurrences.filter(
    (r) => fixedIds.has(r.id) && benefitsOk(r.categoryId, r.accountId),
  );
  for (const occ of projectRecurrences(fixedRecs, range, input.txs, input.cards)) {
    if (occ.realizedTxId === null) {
      fixedCents += occ.amountCents;
    }
  }
  // Ocorrências realizadas (inclusive canceladas, que saem da Base) pela data prevista
  for (const tx of input.txs) {
    if (
      tx.recurrenceId !== null &&
      fixedIds.has(tx.recurrenceId) &&
      tx.recurrenceDate !== null &&
      tx.recurrenceDate >= range.from &&
      tx.recurrenceDate <= range.to &&
      counts(tx) &&
      benefitsOk(tx.categoryId, tx.accountId) &&
      fixedRecs.some((r) => r.id === tx.recurrenceId)
    ) {
      fixedCents += tx.amountCents;
    }
  }

  let variableReceivedCents = 0;
  let variableExpectedCents = 0;
  for (const tx of input.txs) {
    if (
      tx.kind !== 'income' ||
      !counts(tx) ||
      tx.goalId !== null ||
      (tx.recurrenceId !== null && fixedIds.has(tx.recurrenceId)) ||
      monthOf(tx.occurredOn) !== input.month ||
      !benefitsOk(tx.categoryId, tx.accountId)
    ) {
      continue;
    }
    if (!tx.incomeExpected) {
      variableReceivedCents += tx.amountCents;
    } else if (tx.countBeforeReceived) {
      variableExpectedCents += tx.amountCents;
    }
  }
  return {
    fixedCents,
    variableReceivedCents,
    variableExpectedCents,
    totalCents:
      fixedCents + variableReceivedCents + (opts.includeExpected ? variableExpectedCents : 0),
  };
}

export interface BudgetConfig {
  pctBp: Record<Bucket, BasisPoints>;
  alertThresholdsBp: readonly BasisPoints[];
}

export interface BucketStatus {
  bucket: Bucket;
  targetCents: Cents;
  spentCents: Cents; // "já foi" (efetivadas)
  committedCents: Cents; // "vai sair" (previstas e projetadas)
  remainingCents: number;
  usageBp: BasisPoints;
  level: 'ok' | 'warning' | 'over';
}

/** Despesa prevista (RN-05/RN-23): data futura, ou parcela k > 1 cuja fatura vence depois do mês de hoje. */
export function isPredicted(
  tx: Tx,
  today: ISODate,
  invoiceMonthById: ReadonlyMap<string, YearMonth>,
): boolean {
  if (tx.occurredOn > today) {
    return true;
  }
  if ((tx.installmentNumber ?? 1) > 1 && tx.invoiceId !== null) {
    const due = invoiceMonthById.get(tx.invoiceId);
    return due !== undefined && due > monthOf(today);
  }
  return false;
}

interface Consumption {
  spent: Map<string, number>; // por categoria
  committed: Map<string, number>;
}

function add(map: Map<string, number>, key: string, cents: number): void {
  map.set(key, (map.get(key) ?? 0) + cents);
}

/** Consumo por categoria no mês orçamentário (RN-45): despesas − estornos, efetivadas e previstas/projetadas. */
function consumption(input: MonthInput): Consumption {
  const l = lookup(input);
  const out: Consumption = { spent: new Map(), committed: new Map() };
  const NONE = '';
  for (const tx of input.txs) {
    if ((tx.kind !== 'expense' && tx.kind !== 'refund') || !counts(tx)) {
      continue;
    }
    if (!input.includeRestrictedAccounts && l.restricted(tx.accountId)) {
      continue; // RN-35: as despesas pagas com VR/VA saem junto com a receita
    }
    if (budgetMonthOf(tx, input.invoiceMonthById, input.attribution) !== input.month) {
      continue;
    }
    const sign = tx.kind === 'refund' ? -1 : 1;
    const target = isPredicted(tx, input.today, input.invoiceMonthById) ? out.committed : out.spent;
    add(target, tx.categoryId ?? NONE, sign * tx.amountCents);
  }
  // Ocorrências projetadas (ainda sem lançamento) com mês de impacto M
  const prev = monthRange(addMonths(input.month, -1)).from;
  const range = { from: prev, to: monthRange(input.month).to };
  const expenseRecs = input.recurrences.filter(
    (r) => r.kind === 'expense' && (input.includeRestrictedAccounts || !l.restricted(r.accountId)),
  );
  for (const occ of projectRecurrences(expenseRecs, range, input.txs, input.cards)) {
    if (occ.realizedTxId !== null) {
      continue;
    }
    const month =
      occ.invoiceReferenceMonth !== null && input.attribution === 'invoice_due_month'
        ? occ.invoiceReferenceMonth
        : monthOf(occ.date);
    if (month !== input.month) {
      continue;
    }
    const rec = input.recurrences.find((r) => r.id === occ.recurrenceId);
    add(out.committed, rec?.categoryId ?? NONE, occ.amountCents);
  }
  return out;
}

function level(
  usageBp: BasisPoints,
  overflow: boolean,
  thresholds: readonly BasisPoints[],
): BucketStatus['level'] {
  if (overflow) {
    return 'over';
  }
  const first = Math.min(...thresholds.filter((t) => t < 10000), 10000);
  return usageBp >= first ? 'warning' : 'ok';
}

function usage(consumed: number, target: Cents): BasisPoints {
  return target > 0 ? Math.max(0, Math.floor((consumed * 10000) / target)) : 0;
}

/**
 * RN-44/RN-45: meta = applyBp(Base, pct); consumo pela faixa da categoria. Transferências nunca contam (RN-04).
 * Base = 0 → metas 0 e level 'ok' (sem alertas, RN-48). Poupança é mínimo a atingir: sem alerta de excesso (RN-92).
 */
export function bucketBudget(
  input: MonthInput,
  config: BudgetConfig,
  incomeTotalCents: Cents,
): Record<Bucket, BucketStatus> {
  const l = lookup(input);
  const { spent, committed } = consumption(input);
  const sums = Object.fromEntries(BUCKETS.map((b) => [b, { spent: 0, committed: 0 }])) as Record<
    Bucket,
    { spent: number; committed: number }
  >;
  for (const [map, key] of [
    [spent, 'spent'],
    [committed, 'committed'],
  ] as const) {
    for (const [categoryId, cents] of map) {
      const bucket = l.category(categoryId || null)?.bucket;
      if (bucket === 'needs' || bucket === 'wants' || bucket === 'savings') {
        sums[bucket][key] += cents;
      }
    }
  }
  const out = {} as Record<Bucket, BucketStatus>;
  for (const bucket of BUCKETS) {
    const targetCents = incomeTotalCents > 0 ? applyBp(incomeTotalCents, config.pctBp[bucket]) : 0;
    const consumed = sums[bucket].spent + sums[bucket].committed;
    const usageBp = usage(consumed, targetCents);
    out[bucket] = {
      bucket,
      targetCents,
      spentCents: sums[bucket].spent,
      committedCents: sums[bucket].committed,
      remainingCents: targetCents - consumed,
      usageBp,
      level:
        incomeTotalCents <= 0 || bucket === 'savings'
          ? 'ok'
          : level(usageBp, consumed > targetCents, config.alertThresholdsBp),
    };
  }
  return out;
}

/** RN-41: grupo "Sem faixa" (categoria 'none', como "A classificar", ou sem categoria). */
export function unbucketed(input: MonthInput): {
  count: number;
  spentCents: number;
  committedCents: number;
} {
  const l = lookup(input);
  const isNone = (categoryId: string | null) => {
    const cat = l.category(categoryId);
    return cat === undefined || cat.bucket === 'none';
  };
  let count = 0;
  for (const tx of input.txs) {
    if (
      tx.kind === 'expense' &&
      counts(tx) &&
      isNone(tx.categoryId) &&
      budgetMonthOf(tx, input.invoiceMonthById, input.attribution) === input.month &&
      (input.includeRestrictedAccounts || !l.restricted(tx.accountId))
    ) {
      count += 1;
    }
  }
  const { spent, committed } = consumption(input);
  const sum = (map: Map<string, number>) =>
    [...map].filter(([id]) => isNone(id || null)).reduce((acc, [, v]) => acc + v, 0);
  return { count, spentCents: sum(spent), committedCents: sum(committed) };
}

/** Limites por categoria (RN-45): mesma soma restrita à categoria. */
export function categoryBudgets(
  input: MonthInput,
  limits: ReadonlyArray<{
    categoryId: string;
    limitCents: Cents;
    alertThresholdsBp: readonly BasisPoints[];
  }>,
): Array<{
  categoryId: string;
  spentCents: Cents;
  limitCents: Cents;
  usageBp: BasisPoints;
  level: 'ok' | 'warning' | 'over';
}> {
  const { spent, committed } = consumption(input);
  return limits.map((lim) => {
    const consumed = (spent.get(lim.categoryId) ?? 0) + (committed.get(lim.categoryId) ?? 0);
    const usageBp = usage(consumed, lim.limitCents);
    return {
      categoryId: lim.categoryId,
      spentCents: consumed,
      limitCents: lim.limitCents,
      usageBp,
      level:
        lim.limitCents > 0
          ? level(usageBp, consumed > lim.limitCents, lim.alertThresholdsBp)
          : 'ok',
    };
  });
}

export interface ThresholdCrossing {
  scope: 'bucket' | 'category';
  ref: string;
  thresholdBp: BasisPoints;
  month: YearMonth;
}

/** Todas as faixas de alerta já cruzadas; a deduplicação fica no dedupe_key das notificações (RN-92). */
export function thresholdCrossings(
  current: ReadonlyArray<{
    scope: 'bucket' | 'category';
    ref: string;
    usageBp: BasisPoints;
    thresholdsBp: readonly BasisPoints[];
  }>,
  month: YearMonth,
): ThresholdCrossing[] {
  const out: ThresholdCrossing[] = [];
  for (const item of current) {
    for (const thresholdBp of [...item.thresholdsBp].sort((a, b) => a - b)) {
      if (item.usageBp >= thresholdBp) {
        out.push({ scope: item.scope, ref: item.ref, thresholdBp, month });
      }
    }
  }
  return out;
}

/** Percentuais do mês: o registro do mês sobrepõe o padrão (month = null); sem registro, 50/30/20 (RN-43). */
export function resolveBudgetConfig(
  budgets: ReadonlyArray<{
    month: YearMonth | null;
    scope: string;
    bucket: Bucket | null;
    pctBp: number | null;
    alertThresholdsBp: number[];
  }>,
  month: YearMonth,
): BudgetConfig {
  const pctBp: Record<Bucket, BasisPoints> = { ...DEFAULT_PCT_BP };
  let alertThresholdsBp: readonly BasisPoints[] = DEFAULT_THRESHOLDS_BP;
  const rows = budgets.filter((b) => b.scope === 'bucket' && b.bucket !== null && b.pctBp !== null);
  for (const layer of [
    rows.filter((b) => b.month === null),
    rows.filter((b) => b.month === month),
  ]) {
    for (const row of layer) {
      pctBp[row.bucket as Bucket] = row.pctBp as number;
      alertThresholdsBp = row.alertThresholdsBp;
    }
  }
  return { pctBp, alertThresholdsBp };
}
