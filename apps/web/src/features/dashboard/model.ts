// H01 — Início pelo gasto do mês (D-081; US-30, RN-44, RN-46..RN-51): monta a entrada do domínio a partir das linhas
// locais do Dexie e devolve tudo o que o Início mostra (gasto do mês, saldo nas contas, previstas e saúde por faixa). Puro e síncrono: o recálculo roda a cada mudança local (RN-51).
import {
  accountsBalance,
  addDays,
  alertThresholdsBp,
  type BandHealth,
  type BucketStatus,
  bandHealth,
  bucketBudget,
  type CardAttribution,
  clampDay,
  daysInMonth,
  type ISODate,
  invoiceTotals,
  type MonthInput,
  projectRecurrences,
  type Recurrence,
  resolveBudgetConfig,
  resolveProfileSettings,
  type SpendableBreakdown,
  type SpendableConfig,
  spendableThisMonth,
  type Tx,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow } from '../../data/db';
import { accountFromRow, cardFromRow, categoryFromRow, txFromRow } from '../../data/mappers';
import { recurrenceFromRow } from '../recurrences/model';

export const TIME_ZONE = 'America/Sao_Paulo';
/** Itens no card "Próximos 7 dias" (UX §3 H01, item 3). */
export const UPCOMING_MAX = 4;
/** Saídas listadas em "Ainda vencem" no H01-S (RN-49). */
export const NEXT_OUTFLOWS = 3;

export interface HomeRows {
  txRows: readonly LocalRow<'transactions'>[];
  recurrences: readonly LocalRow<'recurrences'>[];
  cards: readonly LocalRow<'cards'>[];
  accounts: readonly LocalRow<'accounts'>[];
  categories: readonly LocalRow<'categories'>[];
  invoices: readonly LocalRow<'invoices'>[];
  budgets: readonly LocalRow<'budgets'>[];
  profile: LocalRow<'profiles'> | null;
}

export interface Outflow {
  key: string;
  kind: 'invoice' | 'fixed' | 'scheduled';
  date: ISODate;
  /** Descrição do lançamento/conta fixa ou nome do cartão (fatura). */
  label: string;
  amountCents: number;
  /** Destino ao tocar: T02 do lançamento, C02 da fatura ou S05. */
  href: string;
}

export interface HomeModel {
  month: YearMonth;
  today: ISODate;
  spendable: SpendableBreakdown;
  config: SpendableConfig;
  savingsPctBp: number;
  /** RN-48: sem renda, o painel mostra "Você já gastou {valor}" = GR + CP. */
  spentAndUpcomingCents: number;
  /** RN-49: as 3 próximas saídas do mês (CP) por data. */
  nextOutflows: Outflow[];
  /** Card "Próximos 7 dias": até 4 saídas de hoje a hoje + 6. */
  upcoming: Outflow[];
  buckets: Record<'needs' | 'wants' | 'savings', BucketStatus>;
  /** D-081: estado de cada faixa no card "Saúde do mês". */
  health: Record<'needs' | 'wants' | 'savings', BandHealth>;
  /** D-081: "Saldo nas contas" (saldo atual das contas; cartões não entram). */
  balanceCents: number;
  /** Lançamentos no mês civil (para o card "Nenhum lançamento em {mês}"). */
  monthHasEntries: boolean;
}

function alive<T extends { deleted_at: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.deleted_at === null);
}

function safeTxs(rows: readonly LocalRow<'transactions'>[]): Tx[] {
  return rows.flatMap((r) => {
    try {
      return [txFromRow(r)];
    } catch {
      return [];
    }
  });
}

function safe<R, T>(rows: readonly R[], map: (row: R) => T): T[] {
  return rows.flatMap((r) => {
    try {
      return [map(r)];
    } catch {
      return [];
    }
  });
}

function recurrencesOf(rows: readonly LocalRow<'recurrences'>[]): Recurrence[] {
  return alive(rows).flatMap((r) => {
    const rec = recurrenceFromRow(r);
    return rec ? [rec] : [];
  });
}

/** Entrada do domínio (tech §5.5) a partir das linhas locais; o mês da fatura é o do vencimento (`reference_month`). */
export function monthInputFromRows(
  rows: HomeRows,
  month: YearMonth,
  today: ISODate,
  attribution: CardAttribution,
  includeRestrictedAccounts: boolean,
): MonthInput {
  return {
    month,
    today,
    txs: safeTxs(rows.txRows),
    recurrences: recurrencesOf(rows.recurrences),
    cards: safe(alive(rows.cards), cardFromRow),
    accounts: safe(alive(rows.accounts), accountFromRow),
    categories: safe(alive(rows.categories), categoryFromRow),
    invoiceMonthById: new Map(
      alive(rows.invoices).map((r) => [r.id, r.reference_month.slice(0, 7) as YearMonth]),
    ),
    attribution,
    includeRestrictedAccounts,
  };
}

function counts(tx: Tx): boolean {
  return (
    tx.deletedAt === null &&
    tx.status !== 'cancelled' &&
    (tx.reviewState === 'ok' || tx.reviewState === 'new')
  );
}

/**
 * Saídas ainda por vir entre `from` e `to` (inclusive): faturas com saldo em aberto pela data de vencimento, contas
 * fixas projetadas e não lançadas (fora do cartão, que já entram na fatura) e despesas agendadas em meio imediato.
 */
export function outflowsBetween(
  rows: HomeRows,
  input: MonthInput,
  from: ISODate,
  to: ISODate,
): Outflow[] {
  const out: Outflow[] = [];
  const cardName = new Map(rows.cards.map((c) => [c.id, c.name]));
  for (const inv of alive(rows.invoices)) {
    if (inv.due_date < from || inv.due_date > to) {
      continue;
    }
    const totals = invoiceTotals(inv.id, input.txs);
    if (totals.balanceCents <= 0) {
      continue;
    }
    out.push({
      key: `invoice:${inv.id}`,
      kind: 'invoice',
      date: inv.due_date as ISODate,
      label: cardName.get(inv.card_id) ?? '',
      amountCents: totals.balanceCents,
      href: `/cartoes/${inv.card_id}/fatura/${inv.reference_month.slice(0, 7)}`,
    });
  }
  const expenses = input.recurrences.filter((r) => r.kind === 'expense' && r.cardId === null);
  for (const occ of projectRecurrences(expenses, { from, to }, input.txs, input.cards)) {
    if (occ.realizedTxId !== null) {
      continue;
    }
    const rec = expenses.find((r) => r.id === occ.recurrenceId);
    out.push({
      key: `fixed:${occ.recurrenceId}:${occ.date}`,
      kind: 'fixed',
      date: occ.date,
      label: rec?.description ?? '',
      amountCents: occ.amountCents,
      href: '/ajustes/renda',
    });
  }
  for (const tx of input.txs) {
    if (
      tx.kind !== 'expense' ||
      tx.cardId !== null ||
      !counts(tx) ||
      tx.occurredOn < from ||
      tx.occurredOn > to ||
      (tx.status !== 'pending' && tx.occurredOn <= input.today)
    ) {
      continue;
    }
    out.push({
      key: `tx:${tx.id}`,
      kind: 'scheduled',
      date: tx.occurredOn,
      label: tx.description ?? '',
      amountCents: tx.amountCents,
      href: `?editar=${tx.id}`,
    });
  }
  return out.sort((a, b) =>
    a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1,
  );
}

/** Mês (o de hoje, por padrão), preferências do cálculo (S06), percentuais do orçamento e a entrada do domínio. */
export function monthContext(
  rows: HomeRows,
  today: ISODate,
  month: YearMonth = today.slice(0, 7) as YearMonth,
) {
  const settings = resolveProfileSettings(rows.profile?.settings ?? {});
  const config = settings.spendable;
  const budget = resolveBudgetConfig(
    alive(rows.budgets).map((b) => ({
      month: b.month === null ? null : (b.month.slice(0, 7) as YearMonth),
      scope: b.scope,
      bucket:
        b.bucket === 'needs' || b.bucket === 'wants' || b.bucket === 'savings' ? b.bucket : null,
      pctBp: b.pct_bp,
      alertThresholdsBp: b.alert_thresholds_bp,
    })),
    month,
    alertThresholdsBp(settings.alerts),
  );
  const input = monthInputFromRows(
    rows,
    month,
    today,
    config.cardAttribution,
    config.includeRestrictedAccounts,
  );
  return { month, settings, config, budget, input };
}

/**
 * Gasto realizado do mês pelo mês de impacto (RN-46), o mesmo número do herói do Início ("Gasto em {mês}") e das
 * faixas da P01: compra no cartão conta no mês da fatura (ou da compra, em competência). `savingsCents` é a parte
 * que foi para categorias de poupança (T-122, D-084 item 2).
 */
export function monthSpent(
  rows: HomeRows,
  month: YearMonth,
  today: ISODate,
): { spentCents: number; savingsCents: number } {
  const { config, budget, input } = monthContext(rows, today, month);
  const spendable = spendableThisMonth(input, budget, config);
  return { spentCents: spendable.spentCents, savingsCents: spendable.savingsDoneCents };
}

export function homeModel(rows: HomeRows, today: ISODate): HomeModel {
  const { month, config, budget, input } = monthContext(rows, today);
  const spendable = spendableThisMonth(input, budget, config);
  const buckets = bucketBudget(input, budget, spendable.income.totalCents);
  const last = clampDay(month, daysInMonth(month));
  const firstOfMonth = clampDay(month, 1);
  return {
    month,
    today,
    spendable,
    config,
    savingsPctBp: budget.pctBp.savings,
    spentAndUpcomingCents: spendable.spentCents + spendable.upcoming.totalCents,
    nextOutflows: outflowsBetween(rows, input, today, last).slice(0, NEXT_OUTFLOWS),
    upcoming: outflowsBetween(rows, input, today, addDays(today, 6)).slice(0, UPCOMING_MAX),
    buckets,
    health: {
      needs: bandHealth(buckets.needs, today),
      wants: bandHealth(buckets.wants, today),
      savings: bandHealth(buckets.savings, today),
    },
    balanceCents: accountsBalance(input.accounts, input.txs, today),
    monthHasEntries: rows.txRows.some(
      (r) => r.deleted_at === null && r.occurred_on >= firstOfMonth && r.occurred_on <= last,
    ),
  };
}

/** "Bom dia" (5h–11h59), "Boa tarde" (12h–17h59), "Boa noite" (18h–4h59) no fuso do cliente. */
export function dayPeriod(now: Date, timeZone = TIME_ZONE): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now),
  );
  if (hour >= 5 && hour < 12) {
    return 'morning';
  }
  return hour >= 12 && hour < 18 ? 'afternoon' : 'evening';
}

/** Primeiro nome do perfil (vem do Google); vazio quando não há. */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? '';
}

export { msUntilNextDay } from '../../lib/useToday';
