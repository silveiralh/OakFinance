// P01 — Orçamento 50/30/20 (US-31, US-32, RN-41, RN-43..RN-45, RN-92): metas por faixa, "já foi" e "vai sair",
// categorias com limite, grupo "Sem faixa" e os avisos de 80%/100% gerados no aparelho.
import {
  type Bucket,
  type BucketStatus,
  bucketBudget,
  categoryBudgets,
  categoryConsumption,
  DEFAULT_REMINDERS,
  type DueNotification,
  dueNotifications,
  type ISODate,
  monthlyIncome,
  type ReminderPref,
  unbucketed,
  type YearMonth,
} from '@oakfinance/domain';
import { monthLimits } from '../../data/repositories/budgets';
import { uiText } from '../../i18n/pt-BR';
import { type HomeRows, monthContext } from '../dashboard/model';

export const BAND_ORDER: readonly Exclude<Bucket, 'income' | 'transfer' | 'none'>[] = [
  'needs',
  'wants',
  'savings',
];

export const BAND_NAME: Record<'needs' | 'wants' | 'savings', string> = {
  needs: uiText.bandNeeds,
  wants: uiText.bandWants,
  savings: uiText.bandSavings,
};

export interface CategoryLine {
  id: string;
  name: string;
  icon: string | null;
  spentCents: number;
  committedCents: number;
  limitCents: number | null;
  usageBp: number;
  level: 'ok' | 'warning' | 'over';
}

export interface BandView {
  bucket: 'needs' | 'wants' | 'savings';
  status: BucketStatus;
  categories: CategoryLine[];
}

export interface BudgetView {
  month: YearMonth;
  incomeCents: number;
  bands: BandView[];
  unbucketed: { count: number; spentCents: number; committedCents: number };
  limits: ReturnType<typeof monthLimits>;
}

export function budgetView(rows: HomeRows, today: ISODate): BudgetView {
  const { month, config, budget, input } = monthContext(rows, today);
  const incomeCents = monthlyIncome(input, {
    includeExpected: config.includeExpectedIncome,
  }).totalCents;
  const statuses = bucketBudget(input, budget, incomeCents);
  const consumption = categoryConsumption(input);
  const limits = monthLimits(rows.budgets, month);
  const limitById = new Map(categoryBudgets(input, limits).map((c) => [c.categoryId, c]));
  const bands = BAND_ORDER.map((bucket) => {
    const categories = rows.categories
      .filter(
        (c) => c.deleted_at === null && c.kind === 'expense' && c.bucket === bucket && !c.is_system,
      )
      .map((c) => {
        const used = consumption.get(c.id) ?? { spentCents: 0, committedCents: 0 };
        const limit = limitById.get(c.id);
        return {
          id: c.id,
          name: c.name,
          icon: c.icon,
          spentCents: used.spentCents,
          committedCents: used.committedCents,
          limitCents: limit?.limitCents ?? null,
          usageBp: limit?.usageBp ?? 0,
          level: limit?.level ?? 'ok',
        };
      })
      // só as que têm movimento no mês ou limite, as de maior consumo primeiro
      .filter((c) => c.spentCents + c.committedCents !== 0 || c.limitCents !== null)
      .sort(
        (a, b) =>
          b.spentCents + b.committedCents - (a.spentCents + a.committedCents) ||
          a.name.localeCompare(b.name, 'pt-BR'),
      );
    return { bucket, status: statuses[bucket], categories };
  });
  return { month, incomeCents, bands, unbucketed: unbucketed(input), limits };
}

const ONLY_BUDGET: ReminderPref[] = DEFAULT_REMINDERS.map((r) => ({
  kind: r.kind,
  enabled: r.kind === 'budget_threshold',
  localTime: r.localTime,
  weekday: r.weekday,
  daysBefore: [...r.daysBefore],
  skipIfLoggedToday: true,
}));

/**
 * RN-92: avisos de 80%/100% de Necessidades, Desejos e categorias com limite, com a mesma `dedupe_key` do
 * `reminders-tick` (`budget:<faixa ou categoria>:<mês>:<limiar>`), para o aviso local e o do servidor serem um só.
 */
export function budgetAlerts(
  rows: HomeRows,
  today: ISODate,
  hideValues: boolean,
): DueNotification[] {
  const { month, config, budget, input } = monthContext(rows, today);
  return dueNotifications({
    nowLocal: { date: today, time: '12:00' },
    windowMinutes: 15,
    prefs: ONLY_BUDGET,
    month: input,
    budget,
    spendable: config,
    invoices: [],
    recurrences: [],
    hideValues,
    labels: {
      categories: Object.fromEntries(rows.categories.map((c) => [c.id, c.name])),
    },
    categoryLimits: monthLimits(rows.budgets, month),
  });
}

/** Faixa ou categoria e o limiar do aviso, pela `dedupe_key`. */
export function parseBudgetKey(
  key: string,
): { ref: string; month: string; thresholdBp: number } | null {
  const m = /^budget:(.+):(\d{4}-\d{2}):(\d+)$/.exec(key);
  return m ? { ref: m[1] as string, month: m[2] as string, thresholdBp: Number(m[3]) } : null;
}
