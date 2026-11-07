// I05 — Conferir importados (US-49; RN-67, RN-68, RN-73, RN-74). Grupos, candidatos e as decisões:
// - "Para decidir": importados `suggested`, cada um com o manual candidato (recalculado pelo `reconcile`);
// - "Novos do banco": importados `new` (não revisados), com OK e "Marcar todos como revisados";
// - "Vinculados automaticamente": importados `merged` com um manual, conciliados nos últimos 7 dias.
// As decisões gravam como edições comuns (outbox). "São diferentes" e "Não é o mesmo" põem o importado na lista
// de separados do conciliador, para ele não sugerir o mesmo par de novo.
import {
  addDays,
  type Category,
  type CategoryRule,
  categorize,
  formatBRL,
  type ISODate,
  matchPatternFor,
  planMerge,
  type ReconItem,
  reconcile,
  UNCLASSIFIED_SLUG,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../../data/db';
import { categoryFromRow } from '../../data/mappers';
import { putInTransaction, writeScope } from '../../data/repositories/rows';
import type { Result } from '../../data/result';
import { writeLocal } from '../../data/storage';
import { deviceId } from '../../data/sync/clock';
import { itemOf, keepApart, reconExtras } from '../../data/sync/reconcile-runner';
import { t } from '../../i18n/pt-BR';
import { formatDateBR } from '../../lib/format';
import { ruleFromRow } from '../quick-entry/model';
import {
  type HistoryClient,
  type HistoryEntry,
  loadHistory,
  restoredRow,
} from '../transactions/history';
import { methodLabel } from '../transactions/TransactionsScreen';

type TxRow = LocalRow<'transactions'>;

const IMPORTED = new Set(['pluggy', 'ofx', 'csv']);
/** "Vinculados automaticamente": últimos 7 dias (RN-68). */
export const AUTO_DAYS = 7;

export interface Decision {
  imported: TxRow;
  /** O manual candidato (o primeiro do `reconcile`); `null` = sem candidato (vira "novo"). */
  manual: TxRow | null;
}

export interface InboxGroups {
  pending: Decision[];
  fresh: TxRow[];
  auto: Array<{ imported: TxRow; manual: TxRow }>;
}

function isImported(row: TxRow): boolean {
  return IMPORTED.has(row.source) && row.deleted_at === null;
}

/** Monta os três grupos a partir dos lançamentos do aparelho. */
export function inboxGroups(
  txs: readonly TxRow[],
  context: {
    today: ISODate;
    invoices: readonly LocalRow<'invoices'>[];
    recurrences: readonly LocalRow<'recurrences'>[];
  },
): InboxGroups {
  const alive = txs.filter((row) => row.deleted_at === null);
  const byId = new Map(alive.map((row) => [row.id, row]));
  const extras = reconExtras(context.invoices, context.recurrences);
  const suggested = alive.filter((row) => isImported(row) && row.review_state === 'suggested');
  const others = alive.filter((row) => !suggested.includes(row)).map((row) => itemOf(row, extras));
  const actions = reconcile(
    suggested.map((row) => itemOf(row, extras)),
    others,
  );
  const pending: Decision[] = [];
  const fresh = alive.filter((row) => isImported(row) && row.review_state === 'new');
  actions.forEach((action, i) => {
    const imported = suggested[i] as TxRow;
    const id =
      action.action === 'suggest'
        ? action.matchIds[0]
        : action.action === 'auto_merge'
          ? action.matchId
          : undefined;
    pending.push({ imported, manual: (id && byId.get(id)) || null });
  });
  const since = addDays(context.today, -AUTO_DAYS);
  const auto = alive
    .filter(
      (row) =>
        isImported(row) &&
        row.review_state === 'merged' &&
        row.duplicate_of !== null &&
        row.client_updated_at.slice(0, 10) >= since,
    )
    .flatMap((imported) => {
      const manual = byId.get(imported.duplicate_of ?? '');
      return manual && !IMPORTED.has(manual.source) ? [{ imported, manual }] : [];
    });
  const order = (a: TxRow, b: TxRow) =>
    b.occurred_on.localeCompare(a.occurred_on) || a.id.localeCompare(b.id);
  return {
    pending: pending.sort((a, b) => order(a.imported, b.imported)),
    fresh: fresh.sort(order),
    auto: auto.sort((a, b) => order(a.imported, b.imported)),
  };
}

/** O contador "{n} para conferir": "Para decidir" + "Novos do banco" (US-49). */
export function inboxCount(groups: InboxGroups): number {
  return groups.pending.length + groups.fresh.length;
}

/** Diferenças do ReconcileCard ("Data diferente: 03/11 × 04/11"), com texto e não só cor. */
export function differences(manual: TxRow, imported: TxRow): string[] {
  const out: string[] = [];
  if (manual.occurred_on !== imported.occurred_on) {
    out.push(
      t('review.diff.date', {
        a: formatDateBR(manual.occurred_on as ISODate).slice(0, 5),
        b: formatDateBR(imported.occurred_on as ISODate).slice(0, 5),
      }),
    );
  }
  if (manual.amount_cents !== imported.amount_cents) {
    out.push(
      t('review.diff.amount', {
        a: formatBRL(manual.amount_cents),
        b: formatBRL(imported.amount_cents),
      }),
    );
  }
  if (manual.payment_method !== imported.payment_method) {
    out.push(
      t('review.diff.method', {
        a: methodLabel(manual.payment_method),
        b: methodLabel(imported.payment_method),
      }),
    );
  }
  return out;
}

async function write(
  db: OakDb,
  rows: readonly TxRow[],
  nowMs: number,
  apart: readonly string[] = [],
) {
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction('rw', [...writeScope(['transactions']), 'kv'], async () => {
      for (const row of rows) {
        await putInTransaction(db, 'transactions', row, device, nowMs);
      }
      if (apart.length > 0) {
        await keepApart(db, apart);
      }
    }),
  );
}

function reconItem(row: TxRow): ReconItem {
  return itemOf(row, reconExtras([], []));
}

/**
 * "É o mesmo" (RN-68): vincula; o manual mantém categoria e descrição e, com valor diferente, passa ao valor do
 * banco (a versão anterior vai para o histórico no servidor).
 */
export async function decideSame(
  db: OakDb,
  imported: TxRow,
  manual: TxRow,
  nowMs = Date.now(),
): Promise<Result<void>> {
  const plan = planMerge(reconItem(imported), reconItem(manual), {
    approx: imported.amount_cents !== manual.amount_cents,
    ...(imported.card_id && imported.invoice_pinned && imported.invoice_id
      ? { bankInvoiceId: imported.invoice_id }
      : {}),
  });
  const patch = plan.manualPatch;
  // RN-70: a 1ª conciliação aceita de uma conta fixa de valor variável grava o termo de conciliação
  const recurrence = manual.recurrence_id
    ? await db.recurrences.get(manual.recurrence_id)
    : undefined;
  const pattern =
    recurrence?.is_variable_amount && !recurrence.match_pattern
      ? matchPatternFor(imported.description ?? imported.description_raw)
      : null;
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction('rw', [...writeScope(['recurrences', 'transactions']), 'kv'], async () => {
      if (recurrence && pattern) {
        await putInTransaction(
          db,
          'recurrences',
          { ...recurrence, match_pattern: pattern },
          device,
          nowMs,
        );
      }
      for (const row of [
        { ...imported, review_state: 'merged', duplicate_of: manual.id } as TxRow,
        {
          ...manual,
          matched_external: true,
          status: patch.status,
          ...(patch.amountCents !== undefined ? { amount_cents: patch.amountCents } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.invoiceId !== undefined
            ? { invoice_id: patch.invoiceId, invoice_pinned: true }
            : {}),
        } as TxRow,
      ]) {
        await putInTransaction(db, 'transactions', row, device, nowMs);
      }
    }),
  );
}

/** "São diferentes": o importado vira um lançamento novo a revisar e o par não é sugerido de novo. */
export function decideDifferent(
  db: OakDb,
  imported: TxRow,
  nowMs = Date.now(),
): Promise<Result<void>> {
  return write(db, [{ ...imported, review_state: 'new' }], nowMs, [imported.id]);
}

/** "Ignorar": descarta o importado (não conta em nada). */
export function ignoreImported(
  db: OakDb,
  imported: TxRow,
  nowMs = Date.now(),
): Promise<Result<void>> {
  return write(db, [{ ...imported, review_state: 'ignored' }], nowMs);
}

/** OK de um item de "Novos do banco" (RN-74). */
export function markReviewed(db: OakDb, row: TxRow, nowMs = Date.now()): Promise<Result<void>> {
  return write(db, [{ ...row, review_state: 'ok' }], nowMs);
}

export type BulkResult = { kind: 'done'; n: number } | { kind: 'blocked'; unclassified: number };

/** "Marcar todos como revisados" (RN-74): recusa se algum estiver em "A classificar" (ou sem categoria). */
export async function markAllReviewed(
  db: OakDb,
  rows: readonly TxRow[],
  categories: readonly LocalRow<'categories'>[],
  nowMs = Date.now(),
): Promise<BulkResult> {
  const unclassified = new Set(
    categories.filter((c) => c.slug === UNCLASSIFIED_SLUG).map((c) => c.id),
  );
  const blocked = rows.filter(
    (row) =>
      (row.kind === 'expense' || row.kind === 'refund') &&
      (row.category_id === null || unclassified.has(row.category_id)),
  ).length;
  if (blocked > 0) {
    return { kind: 'blocked', unclassified: blocked };
  }
  const result = await write(
    db,
    rows.map((row) => ({ ...row, review_state: 'ok' })),
    nowMs,
  );
  return result.ok ? { kind: 'done', n: rows.length } : { kind: 'done', n: 0 };
}

/**
 * "Não é o mesmo" (RN-73): separa os dois. O manual perde o vínculo; o importado volta a ser um lançamento próprio
 * a revisar, fora das sugestões do conciliador.
 */
export function unlink(
  db: OakDb,
  imported: TxRow,
  manual: TxRow,
  nowMs = Date.now(),
): Promise<Result<void>> {
  return write(
    db,
    [
      { ...imported, review_state: 'new', duplicate_of: null },
      { ...manual, matched_external: false },
    ],
    nowMs,
    [imported.id],
  );
}

/**
 * Versão do manual anterior à conciliação (RN-73): a mais recente do histórico em que ele ainda não estava
 * vinculado a uma fonte externa. `null` sem histórico (offline) ou sem essa versão.
 */
export function versionBeforeMerge(
  history: readonly HistoryEntry[],
): Record<string, unknown> | null {
  for (const entry of history) {
    if (entry.op === 'update' && entry.oldRow && entry.oldRow.matched_external === false) {
      return entry.oldRow;
    }
  }
  return null;
}

export interface CategoryContext {
  rules: readonly CategoryRule[];
  categories: readonly Category[];
}

/** RN-73/RN-61: o importado separado volta a `new` com a categoria da regra que casar (senão a que já tinha). */
function separated(imported: TxRow, ctx: CategoryContext): TxRow {
  const hit = categorize(
    {
      description: imported.description ?? imported.description_raw,
      merchantCnpj: imported.merchant_cnpj,
      paymentMethod: imported.payment_method as never,
      kind: imported.kind as never,
      accountId: imported.account_id,
      cardId: imported.card_id,
    },
    ctx.rules,
    ctx.categories,
  );
  return {
    ...imported,
    review_state: 'new',
    duplicate_of: null,
    ...(hit
      ? { category_id: hit.categoryId, category_source: 'rule', category_rule_id: hit.ruleId }
      : {}),
  };
}

/**
 * "Não é o mesmo" (US-51, RN-73): o manual volta à versão anterior à conciliação (pelo histórico do servidor;
 * sem ele, só perde o vínculo) e o importado vira um lançamento novo a revisar, com a categoria da regra.
 */
export function unlinkRestoring(
  db: OakDb,
  imported: TxRow,
  manual: TxRow,
  history: readonly HistoryEntry[] | null,
  ctx: CategoryContext,
  nowMs = Date.now(),
): Promise<Result<void>> {
  const before = history ? versionBeforeMerge(history) : null;
  const restored = before ? restoredRow(manual, before) : null;
  return write(
    db,
    [separated(imported, ctx), { ...(restored ?? manual), matched_external: false }],
    nowMs,
    [imported.id],
  );
}

/** "Não é duplicada" (US-51): a transação marcada como duplicada de outra fonte vira um lançamento próprio. */
export function notDuplicate(
  db: OakDb,
  imported: TxRow,
  ctx: CategoryContext,
  nowMs = Date.now(),
): Promise<Result<void>> {
  return write(db, [separated(imported, ctx)], nowMs, [imported.id]);
}

/** Regras e categorias vivas do aparelho, para a categoria do importado separado. */
export async function categoryContext(db: OakDb): Promise<CategoryContext> {
  const [rules, categories] = await Promise.all([
    db.category_rules.toArray(),
    db.categories.toArray(),
  ]);
  return {
    rules: rules.filter((r) => r.deleted_at === null).map(ruleFromRow),
    categories: categories.filter((c) => c.deleted_at === null).map(categoryFromRow),
  };
}

/** Histórico do manual pela RPC (precisa de internet); `null` sem cliente ou se falhar. */
export async function manualHistory(
  client: unknown,
  manualId: string,
): Promise<HistoryEntry[] | null> {
  if (!client) {
    return null;
  }
  try {
    return await loadHistory(client as HistoryClient, manualId);
  } catch {
    return null;
  }
}
