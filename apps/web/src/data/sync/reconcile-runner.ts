// Conciliador no aparelho (tech §4.6 passo 6, ADR-10; US-48, RN-65..RN-68, RN-72). Depois do pull, as linhas
// importadas (`pluggy`/`ofx`/`csv`) com `review_state = 'new'` que chegaram desde a última rodada passam pelo
// `reconcile` do domínio contra os lançamentos do aparelho — inclusive os que ainda estão na outbox:
// - `auto_merge` → `planMerge` (RN-68): o importado vira `merged` com `duplicate_of`; o manual recebe o vínculo;
// - `suggest` → `suggested` ("É o mesmo?"), fora dos agregados até a decisão (RN-67);
// - `duplicate` → `merged` com `duplicate_of` no importado da outra fonte (RN-72);
// - `new` → continua `new` e, sem categoria, recebe "A classificar" (RN-61).
// Tudo numa transação Dexie, como edições comuns (vão para a outbox).
import {
  type ISODate,
  planMerge,
  type ReconAction,
  type ReconItem,
  reconcile,
  UNCLASSIFIED_SLUG,
  type YearMonth,
} from '@oakfinance/domain';
import type { LocalRow, OakDb } from '../db';
import { putInTransaction, writeScope } from '../repositories/rows';
import { writeLocal } from '../storage';
import { deviceId } from './clock';

type TxRow = LocalRow<'transactions'>;

const IMPORTED_SOURCES = new Set(['pluggy', 'ofx', 'csv']);
/** Maior `server_version` de importado já conciliado (kv). */
export const RECONCILE_KEY = 'reconcile_version';
/** Quanto olhar para trás nos lançamentos do aparelho (RN-66, `lookbackDays` = 90, com folga). */
const LOOKBACK_DAYS = 100;

export interface ReconcileSummary {
  /** Importados avaliados nesta rodada. */
  checked: number;
  merged: number;
  suggested: number;
  duplicates: number;
  fresh: number;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ReconExtras {
  invoiceMonth: Map<string, string>;
  recurrences: Map<string, LocalRow<'recurrences'>>;
}

/** Mês das faturas e recorrências (termo e valor variável, RN-70) para montar os `ReconItem`. */
export function reconExtras(
  invoices: readonly LocalRow<'invoices'>[],
  recurrences: readonly LocalRow<'recurrences'>[],
): ReconExtras {
  return {
    invoiceMonth: new Map(invoices.map((inv) => [inv.id, inv.reference_month])),
    recurrences: new Map(recurrences.map((r) => [r.id, r])),
  };
}

/** Importados que o usuário separou ("São diferentes", "Não é o mesmo"): o conciliador não os sugere de novo. */
export const APART_KEY = 'reconcile_apart';
const APART_MAX = 2000;

async function apartIds(db: OakDb): Promise<Set<string>> {
  const value = (await db.kv.get(APART_KEY))?.value;
  return new Set(Array.isArray(value) ? (value as string[]) : []);
}

/** Acrescenta à lista de separados (chame dentro de uma transação com `kv`). */
export async function keepApart(db: OakDb, ids: readonly string[]): Promise<void> {
  const current = [...(await apartIds(db))].filter((id) => !ids.includes(id));
  await db.kv.put({ key: APART_KEY, value: [...current, ...ids].slice(-APART_MAX) });
}

export function itemOf(row: TxRow, extras: ReconExtras): ReconItem {
  const recurrence = row.recurrence_id ? extras.recurrences.get(row.recurrence_id) : undefined;
  const month = row.invoice_id ? extras.invoiceMonth.get(row.invoice_id) : undefined;
  return {
    id: row.id,
    kind: row.kind as ReconItem['kind'],
    amountCents: row.amount_cents,
    occurredOn: row.occurred_on as ISODate,
    accountId: row.account_id,
    cardId: row.card_id,
    description: row.description ?? row.description_raw,
    source: row.source as ReconItem['source'],
    externalId: row.external_id,
    installmentNumber: row.installment_number,
    installmentCount: row.installment_count,
    matchedExternal: row.matched_external,
    reviewState: row.review_state as ReconItem['reviewState'],
    paymentMethod: row.payment_method as NonNullable<ReconItem['paymentMethod']>,
    cancelled: row.status === 'cancelled',
    isVariableAmount: recurrence?.is_variable_amount ?? false,
    matchPattern: recurrence?.match_pattern ?? null,
    ...(month ? { invoiceMonth: month.slice(0, 7) as YearMonth } : {}),
  };
}

async function readCursor(db: OakDb): Promise<number> {
  const value = (await db.kv.get(RECONCILE_KEY))?.value;
  return typeof value === 'number' ? value : 0;
}

/**
 * Concilia os importados novos desde a última rodada. Não lança: falha de escrita local volta como resumo vazio
 * (a próxima rodada tenta de novo, porque o cursor só avança com a gravação).
 */
export async function runReconcile(
  db: OakDb,
  { nowMs = Date.now() }: { nowMs?: number } = {},
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    checked: 0,
    merged: 0,
    suggested: 0,
    duplicates: 0,
    fresh: 0,
  };
  const cursor = await readCursor(db);
  const apart = await apartIds(db);
  const candidates = (await db.transactions.where('review_state').equals('new').toArray()).filter(
    (row) =>
      IMPORTED_SOURCES.has(row.source) &&
      row.deleted_at === null &&
      row.server_version > cursor &&
      !apart.has(row.id),
  );
  if (candidates.length === 0) {
    return summary;
  }
  const oldest = candidates.reduce(
    (min, row) => (row.occurred_on < min ? row.occurred_on : min),
    candidates[0]?.occurred_on ?? '',
  );
  const from = addDays(oldest, -LOOKBACK_DAYS);
  const ids = new Set(candidates.map((row) => row.id));
  const [pool, invoices, recurrences, categories] = await Promise.all([
    db.transactions.where('occurred_on').aboveOrEqual(from).toArray(),
    db.invoices.toArray(),
    db.recurrences.toArray(),
    db.categories.toArray(),
  ]);
  const extras = reconExtras(invoices, recurrences);
  const alive = pool.filter((row) => row.deleted_at === null);
  const byId = new Map(alive.map((row) => [row.id, row]));
  const existing = alive.filter((row) => !ids.has(row.id)).map((row) => itemOf(row, extras));
  const imported = candidates.map((row) => itemOf(row, extras));
  const actions: ReconAction[] = reconcile(imported, existing);
  const unclassified = categories.find(
    (c) => c.slug === UNCLASSIFIED_SLUG && c.deleted_at === null,
  )?.id;
  const maxVersion = candidates.reduce((max, row) => Math.max(max, row.server_version), cursor);

  const device = await deviceId(db);
  const result = await writeLocal(() =>
    db.transaction('rw', [...writeScope(['transactions']), 'kv'], async () => {
      const save = (row: TxRow) => putInTransaction(db, 'transactions', row, device, nowMs);
      for (const action of actions) {
        const row =
          byId.get(action.importedId) ?? candidates.find((c) => c.id === action.importedId);
        if (!row) {
          continue;
        }
        summary.checked += 1;
        if (action.action === 'auto_merge') {
          const manual = byId.get(action.matchId);
          if (!manual) {
            continue;
          }
          const plan = planMerge(itemOf(row, extras), itemOf(manual, extras), {
            approx: false,
            ...(row.card_id && row.invoice_pinned && row.invoice_id
              ? { bankInvoiceId: row.invoice_id }
              : {}),
          });
          await save({
            ...row,
            review_state: 'merged',
            duplicate_of: plan.importedPatch.duplicateOf,
          });
          const patch = plan.manualPatch;
          await save({
            ...manual,
            matched_external: true,
            status: patch.status,
            ...(patch.amountCents !== undefined ? { amount_cents: patch.amountCents } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.invoiceId !== undefined
              ? { invoice_id: patch.invoiceId, invoice_pinned: true }
              : {}),
          });
          summary.merged += 1;
        } else if (action.action === 'suggest') {
          await save({ ...row, review_state: 'suggested' });
          summary.suggested += 1;
        } else if (action.action === 'duplicate') {
          await save({ ...row, review_state: 'merged', duplicate_of: action.ofImportedId });
          summary.duplicates += 1;
        } else {
          summary.fresh += 1;
          const expense = row.kind === 'expense' || row.kind === 'refund';
          if (row.category_id === null && expense && unclassified) {
            await save({ ...row, category_id: unclassified, category_source: 'none' });
          }
        }
      }
      await db.kv.put({ key: RECONCILE_KEY, value: maxVersion });
    }),
  );
  return result.ok ? summary : { checked: 0, merged: 0, suggested: 0, duplicates: 0, fresh: 0 };
}
