// P04 — Fechar o mês (US-36, RN-77). Checklist: importados com data no mês pendentes de decisão e não revisados,
// lançamentos do mês orçamentário em "A classificar" (ou sem categoria) e faturas com vencimento no mês ainda não
// pagas (a não ser que o saldo em aberto tenha sido confirmado). Fechar grava `month_closings` (id v5 por mês)
// com o snapshot dos totais; editar um lançamento de um mês fechado o reabre para revisão.
import {
  bucketBudget,
  budgetMonthOf,
  type ISODate,
  invoicePeriod,
  invoiceStatus,
  invoiceTotals,
  monthClosingId,
  spendableThisMonth,
  UNCLASSIFIED_SLUG,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { cardFromRow, txFromRow } from '../../data/mappers';
import { saveRow } from '../../data/repositories/rows';
import type { Result } from '../../data/result';
import { type HomeRows, monthContext } from '../dashboard/model';
import { MONTH_NAMES } from '../transactions/list';
import { referenceDay } from './analysis';

type Closing = LocalRow<'month_closings'>;
const IMPORTED = new Set(['pluggy', 'ofx', 'csv']);

export interface OpenInvoice {
  invoiceId: string;
  cardName: string;
  balanceCents: number;
}

export interface Checklist {
  month: YearMonth;
  suggested: number;
  unreviewed: number;
  unclassified: number;
  openInvoices: OpenInvoice[];
}

/** "outubro" (o nome do mês, como no título "Fechar outubro"). */
export function monthName(month: YearMonth): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

/** "Outubro" (o nome do mês no começo da frase: "Outubro fechado."). */
export function monthTitle(month: YearMonth): string {
  const name = monthName(month);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Linha de `month_closings` do mês, se houver. */
export function closingOf(closings: readonly Closing[], month: YearMonth): Closing | null {
  return closings.find((c) => c.deleted_at === null && c.month.slice(0, 7) === month) ?? null;
}

export function isMonthClosed(closings: readonly Closing[], month: YearMonth): boolean {
  return closingOf(closings, month)?.closed_at != null;
}

function confirmedInvoices(closing: Closing | null): Set<string> {
  const value = (closing?.snapshot as { confirmedInvoices?: unknown } | null)?.confirmedInvoices;
  return new Set(Array.isArray(value) ? (value as string[]) : []);
}

/** RN-77: as pendências do mês. */
export function closingChecklist(
  rows: HomeRows,
  closings: readonly Closing[],
  month: YearMonth,
  today: ISODate,
): Checklist {
  const { input } = monthContext(rows, referenceDay(month, today));
  const alive = rows.txRows.filter((r) => r.deleted_at === null && r.status !== 'cancelled');
  const inMonth = (r: LocalRow<'transactions'>) => r.occurred_on.slice(0, 7) === month;
  const imported = alive.filter((r) => IMPORTED.has(r.source) && inMonth(r));
  const unclassifiedIds = new Set(
    rows.categories.filter((c) => c.slug === UNCLASSIFIED_SLUG).map((c) => c.id),
  );
  const unclassified = alive.filter((r) => {
    if (r.kind !== 'expense' && r.kind !== 'refund') {
      return false;
    }
    if (
      r.review_state === 'merged' ||
      r.review_state === 'ignored' ||
      r.review_state === 'suggested'
    ) {
      return false;
    }
    if (r.category_id !== null && !unclassifiedIds.has(r.category_id)) {
      return false;
    }
    return budgetMonthOf(txFromRow(r), input.invoiceMonthById, input.attribution) === month;
  }).length;
  const confirmed = confirmedInvoices(closingOf(closings, month));
  const allTx = alive.map(txFromRow);
  const openInvoices: OpenInvoice[] = [];
  for (const inv of rows.invoices) {
    if (inv.deleted_at !== null || inv.due_date.slice(0, 7) !== month || confirmed.has(inv.id)) {
      continue;
    }
    const cardRow = rows.cards.find((c) => c.id === inv.card_id);
    if (!cardRow) {
      continue;
    }
    const period = {
      ...invoicePeriod(cardFromRow(cardRow), inv.reference_month.slice(0, 7) as YearMonth),
      id: inv.id,
      closingDate: inv.closing_date as ISODate,
      dueDate: inv.due_date as ISODate,
    };
    const totals = invoiceTotals(inv.id, allTx);
    if (totals.balanceCents > 0 && invoiceStatus(period, totals, today) !== 'paid') {
      openInvoices.push({
        invoiceId: inv.id,
        cardName: cardRow.name,
        balanceCents: totals.balanceCents,
      });
    }
  }
  return {
    month,
    suggested: imported.filter((r) => r.review_state === 'suggested').length,
    unreviewed: imported.filter((r) => r.review_state === 'new').length,
    unclassified,
    openInvoices,
  };
}

export function canClose(list: Checklist): boolean {
  return (
    list.suggested === 0 &&
    list.unreviewed === 0 &&
    list.unclassified === 0 &&
    list.openInvoices.length === 0
  );
}

/** Snapshot dos totais no fechamento (RN-77): disponível, renda, gasto, a vencer, poupança e as faixas. */
export function closingSnapshot(
  rows: HomeRows,
  month: YearMonth,
  today: ISODate,
): Record<string, unknown> {
  const { config, budget, input } = monthContext(rows, referenceDay(month, today));
  const s = spendableThisMonth(input, budget, config);
  return {
    availableCents: s.availableCents,
    incomeCents: s.income.totalCents,
    spentCents: s.spentCents,
    upcomingCents: s.upcoming.totalCents,
    savingsDoneCents: s.savingsDoneCents,
    status: s.status,
  };
}

/**
 * Resumo da P04 antes de fechar (UXB-018, UX §3 P04): renda, gasto por faixa e guardado, com os mesmos números do
 * snapshot (RN-77).
 */
export function closingSummary(
  rows: HomeRows,
  month: YearMonth,
  today: ISODate,
): {
  incomeCents: number;
  spentCents: number;
  savingsDoneCents: number;
  bands: { bucket: 'needs' | 'wants'; spentCents: number }[];
} {
  const { config, budget, input } = monthContext(rows, referenceDay(month, today));
  const s = spendableThisMonth(input, budget, config);
  const statuses = bucketBudget(input, budget, s.income.totalCents);
  return {
    incomeCents: s.income.totalCents,
    spentCents: s.spentCents,
    savingsDoneCents: s.savingsDoneCents,
    bands: (['needs', 'wants'] as const).map((bucket) => ({
      bucket,
      spentCents: statuses[bucket].spentCents,
    })),
  };
}

function closingRow(
  userId: string,
  month: YearMonth,
  current: Closing | null,
  patch: Pick<Closing, 'closed_at' | 'snapshot'>,
  nowIso: string,
): Closing {
  return {
    id: current?.id ?? monthClosingId(userId, month),
    user_id: userId,
    month: `${month}-01`,
    created_at: current?.created_at ?? nowIso,
    updated_at: nowIso,
    client_updated_at: nowIso,
    deleted_at: null,
    server_version: current?.server_version ?? 0,
    device_id: null,
    ...patch,
  };
}

/** "Fechar mês": grava o fechamento com o snapshot (refeito a cada fechamento). */
export function closeMonth(
  db: OakDb,
  userId: string,
  rows: HomeRows,
  closings: readonly Closing[],
  month: YearMonth,
  today: ISODate,
  nowMs = Date.now(),
): Promise<Result<Closing>> {
  const current = closingOf(closings, month);
  const nowIso = new Date(nowMs).toISOString();
  const confirmed = [...confirmedInvoices(current)];
  return saveRow(
    db,
    'month_closings',
    closingRow(
      userId,
      month,
      current,
      {
        closed_at: nowIso,
        snapshot: { ...closingSnapshot(rows, month, today), confirmedInvoices: confirmed },
      },
      nowIso,
    ),
    { nowMs },
  );
}

/** "Confirmar saldo em aberto" de uma fatura: guardado na linha do mês, ainda aberta. */
export function confirmOpenInvoice(
  db: OakDb,
  userId: string,
  closings: readonly Closing[],
  month: YearMonth,
  invoiceId: string,
  nowMs = Date.now(),
): Promise<Result<Closing>> {
  const current = closingOf(closings, month);
  const nowIso = new Date(nowMs).toISOString();
  const confirmed = [...confirmedInvoices(current), invoiceId];
  return saveRow(
    db,
    'month_closings',
    closingRow(
      userId,
      month,
      current,
      {
        closed_at: current?.closed_at ?? null,
        snapshot: {
          ...((current?.snapshot as Record<string, unknown> | null) ?? {}),
          confirmedInvoices: confirmed,
        },
      },
      nowIso,
    ),
    { nowMs },
  );
}

/** "Reabrir para revisão" e o "Salvar mesmo assim" de um mês fechado: `closed_at = null`, snapshot guardado. */
export async function reopenMonth(
  db: OakDb,
  userId: string,
  month: YearMonth,
  nowMs = Date.now(),
): Promise<Result<Closing | null>> {
  const current = closingOf(await db.month_closings.toArray(), month);
  if (!current || current.closed_at === null) {
    return { ok: true, value: current };
  }
  const nowIso = new Date(nowMs).toISOString();
  return saveRow(
    db,
    'month_closings',
    closingRow(userId, month, current, { closed_at: null, snapshot: current.snapshot }, nowIso),
    { nowMs },
  );
}
