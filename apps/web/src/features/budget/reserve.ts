// P02 — Reserva de emergência (US-33, US-65, RN-36, RN-52..RN-56): meta sugerida ou manual, progresso com saldo
// inicial, aportes e resgates, projeção e o marco "meta atingida" (uma vez).
import {
  addMonths,
  bucketBudget,
  clampDay,
  daysInMonth,
  type ISODate,
  monthlyIncome,
  monthlyNeedsHistory,
  noticeId,
  type ReserveProgress,
  reserveProgress,
  suggestedReserveTarget,
  type Tx,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { newId } from '../../data/ids';
import { saveRow } from '../../data/repositories/rows';
import { type HomeRows, monthContext, monthInputFromRows } from '../dashboard/model';

export type GoalRow = LocalRow<'goals'>;

export interface ReserveMove {
  id: string;
  kind: 'save' | 'withdraw';
  date: ISODate;
  amountCents: number;
}

export interface ReserveView {
  goal: GoalRow;
  /** Meta em vigor: manual, ou a sugestão (pode ser provisória); `null` sem meta (Base = 0 e sem histórico). */
  targetCents: number | null;
  suggestion: ReturnType<typeof suggestedReserveTarget>;
  /** RN-53: com meta manual, a sugestão mudou mais de 10%. */
  suggestionChanged: boolean;
  progress: ReserveProgress;
  percent: number;
  moves: ReserveMove[];
}

/**
 * RN-54: aporte é despesa em categoria de Poupança que alimenta a reserva, em meio imediato. O domínio conta pelo
 * `goalId`; um aporte lançado pelo Q01 comum (sem `goal_id`) recebe o da reserva aqui. Resgate = receita com `goalId`.
 */
export function reserveTxs(txs: readonly Tx[], rows: HomeRows, goalId: string): Tx[] {
  const feeds = new Set(
    rows.categories.filter((c) => c.feeds_reserve && c.deleted_at === null).map((c) => c.id),
  );
  return txs.flatMap((tx) => {
    if (tx.goalId === goalId) {
      return [tx];
    }
    if (
      tx.goalId === null &&
      tx.kind === 'expense' &&
      tx.cardId === null &&
      tx.categoryId !== null &&
      feeds.has(tx.categoryId)
    ) {
      return [{ ...tx, goalId }];
    }
    return [];
  });
}

/** Necessidades efetivadas dos 6 meses civis completos anteriores a M (RN-52). */
function needsHistory(rows: HomeRows, month: YearMonth, lookback: number) {
  const { config } = monthContext(rows, clampDay(month, 1));
  const inputs = Array.from({ length: lookback }, (_, i) => {
    const m = addMonths(month, -(i + 1));
    return monthInputFromRows(
      rows,
      m,
      clampDay(m, daysInMonth(m)),
      config.cardAttribution,
      config.includeRestrictedAccounts,
    );
  });
  return monthlyNeedsHistory(inputs);
}

export function reserveView(rows: HomeRows, goal: GoalRow, today: ISODate): ReserveView {
  const { month, config, budget, input } = monthContext(rows, today);
  const base = monthlyIncome(input, { includeExpected: config.includeExpectedIncome }).totalCents;
  const needsTarget = bucketBudget(input, budget, base).needs.targetCents;
  const history = needsHistory(rows, month, goal.auto_lookback_months);
  const suggestion = suggestedReserveTarget(history, needsTarget, {
    factor: goal.auto_factor,
    lookbackMonths: goal.auto_lookback_months,
  });
  const manual = goal.target_mode === 'manual' && goal.target_cents !== null;
  const targetCents = manual ? goal.target_cents : (suggestion?.targetCents ?? null);
  const txs = reserveTxs(input.txs, rows, goal.id);
  const progress = reserveProgress(
    {
      id: goal.id,
      targetMode: 'manual',
      targetCents: targetCents ?? 0,
      autoFactor: goal.auto_factor,
      autoLookbackMonths: goal.auto_lookback_months,
      initialSavedCents: goal.initial_saved_cents,
    },
    txs,
    history.filter((h) => h.expenseCount >= 5),
    today,
  );
  const suggestionChanged =
    manual &&
    suggestion !== null &&
    goal.target_cents !== null &&
    Math.abs(suggestion.targetCents - goal.target_cents) * 10 > goal.target_cents;
  const moves = txs
    .filter((tx) => tx.deletedAt === null && tx.status !== 'cancelled')
    .map((tx) => ({
      id: tx.id,
      kind: tx.kind === 'income' ? ('withdraw' as const) : ('save' as const),
      date: tx.occurredOn,
      amountCents: tx.amountCents,
    }))
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? 1 : -1));
  return {
    goal,
    targetCents,
    suggestion,
    suggestionChanged,
    progress,
    percent: Math.floor(progress.progressBp / 100),
    moves,
  };
}

/** Percentual depois de um movimento (texto "A reserva está em {p}% da meta"). */
export function percentAfter(view: ReserveView, deltaCents: number): number {
  const target = view.targetCents ?? 0;
  const saved = view.progress.savedCents + deltaCents;
  return target > 0 && saved > 0 ? Math.min(100, Math.floor((saved * 100) / target)) : 0;
}

/** Guardar (aporte, RN-54) ou registrar uso da reserva (resgate, RN-36) a partir de uma conta. */
export async function saveReserveMove(
  db: OakDb,
  userId: string,
  input: {
    kind: 'save' | 'withdraw';
    goalId: string;
    accountId: string;
    amountCents: number;
    date: ISODate;
    categoryId: string | null;
    description: string;
  },
): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await saveRow(db, 'transactions', {
    id,
    user_id: userId,
    kind: input.kind === 'save' ? 'expense' : 'income',
    status: 'posted',
    amount_cents: input.amountCents,
    occurred_on: input.date,
    occurred_at: null,
    description: input.description,
    description_raw: null,
    notes: null,
    category_id: input.categoryId,
    category_source: 'user',
    category_rule_id: null,
    payment_method: 'transfer',
    account_id: input.accountId,
    card_id: null,
    invoice_id: null,
    invoice_pinned: false,
    counterpart_account_id: null,
    counterpart_card_id: null,
    series_id: null,
    installment_number: null,
    installment_count: null,
    recurrence_id: null,
    recurrence_date: null,
    goal_id: input.goalId,
    income_expected: false,
    count_before_received: false,
    source: 'manual',
    external_id: null,
    external_meta: null,
    import_id: null,
    review_state: 'ok',
    duplicate_of: null,
    matched_external: false,
    merchant_name: null,
    merchant_cnpj: null,
    nfce_receipt_id: null,
    tags: [],
    created_at: now,
    updated_at: now,
    client_updated_at: now,
    deleted_at: null,
    server_version: 0,
    device_id: null,
  });
  return id;
}

/** Meta manual (RN-53), voltar à sugestão (`null`) ou o valor já guardado (RN-55). */
export async function updateGoal(
  db: OakDb,
  goal: GoalRow,
  change: { targetCents?: number | null; initialSavedCents?: number },
): Promise<void> {
  const next: GoalRow = { ...goal };
  if (change.targetCents !== undefined) {
    next.target_mode = change.targetCents === null ? 'auto' : 'manual';
    next.target_cents = change.targetCents;
  }
  if (change.initialSavedCents !== undefined) {
    next.initial_saved_cents = change.initialSavedCents;
  }
  await saveRow(db, 'goals', next);
}

export const RESERVE_FULL_KEY = (goalId: string) => `reserve_full:${goalId}`;

/**
 * RN-56/US-65: na primeira vez que o progresso alcança a meta, grava `achieved_at` e o aviso único "Reserva de
 * emergência completa" (id v5 da dedupe_key: nunca repete). Devolve `true` quando o marco foi registrado agora.
 */
export async function markAchieved(
  db: OakDb,
  userId: string,
  view: ReserveView,
  texts: { title: string; body: string },
): Promise<boolean> {
  if (!view.progress.achieved || view.goal.achieved_at !== null) {
    return false;
  }
  const now = new Date().toISOString();
  await saveRow(db, 'goals', { ...view.goal, achieved_at: now });
  const key = RESERVE_FULL_KEY(view.goal.id);
  if (!(await db.notices.get(noticeId(userId, key)))) {
    await saveRow(db, 'notices', {
      id: noticeId(userId, key),
      user_id: userId,
      kind: 'reserve_full',
      dedupe_key: key,
      title: texts.title,
      body: texts.body,
      navigate: '/planejar/reserva',
      read_at: null,
      created_at: now,
      updated_at: now,
      client_updated_at: now,
      deleted_at: null,
      server_version: 0,
      device_id: null,
    });
  }
  return true;
}
