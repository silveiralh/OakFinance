// Pull (tech §4.6): `sync_pull` por cursor, uma transação Dexie por página com o cursor gravado junto, proteção
// da edição local que ainda vai subir e `reset_required` (resync completo preservando a outbox).
import { type LocalRow, type OakDb, SYNCED_TABLES, type SyncedTable } from '../db';
import { MapperError, parseRow } from '../mappers';
import { recordServerTime } from './clock';
import { callRpc, RpcFailure, type SyncTransport } from './transport';

export const PULL_LIMIT = 500;
/** Tombstones locais ficam 30 dias para não "ressuscitar" a linha (tech §4.6, passo 4). */
export const LOCAL_TOMBSTONE_DAYS = 30;

interface PullRow {
  t: string;
  v: number;
  r: Record<string, unknown>;
}

interface PullPage {
  rows?: PullRow[];
  next?: number;
  has_more?: boolean;
  server_time?: string;
  reset_required?: boolean;
}

export interface PullSummary {
  pages: number;
  rows: number;
  skipped: number;
  /** G06: lançamentos que já estavam no aparelho e chegaram editados por outro aparelho. */
  remoteEdits: number;
  reset: boolean;
  failure: RpcFailure | null;
}

const synced = new Set<string>(SYNCED_TABLES);

export async function readCursor(db: OakDb): Promise<number> {
  const entry = await db.sync_state.get('cursor');
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/** Apaga as tabelas locais **menos** `outbox`, `sync_state` e `kv`, e volta o cursor a 0. */
export async function resetLocalData(db: OakDb): Promise<void> {
  await db.transaction('rw', [...SYNCED_TABLES, 'sync_state'], async () => {
    for (const table of SYNCED_TABLES) {
      await db.table(table).clear();
    }
    await db.sync_state.put({ key: 'cursor', value: 0 });
  });
}

async function applyPage(
  db: OakDb,
  page: PullPage,
  cursor: number,
  device: string | null,
): Promise<{ rows: number; skipped: number; remoteEdits: number }> {
  let rows = 0;
  let skipped = 0;
  let remoteEdits = 0;
  await db.transaction('rw', [...SYNCED_TABLES, 'outbox', 'sync_state'], async () => {
    for (const item of page.rows ?? []) {
      if (!synced.has(item.t)) {
        skipped += 1;
        continue;
      }
      const table = item.t as SyncedTable;
      let row: LocalRow<SyncedTable>;
      try {
        row = parseRow(table, item.r) as LocalRow<SyncedTable>;
      } catch (error) {
        if (error instanceof MapperError) {
          skipped += 1;
          continue;
        }
        throw error;
      }
      const pending = await db.outbox
        .where('[table+row_id]')
        .equals([table, row.id])
        .filter((entry) => entry.state !== 'rejected')
        .count();
      if (pending > 0) {
        const local = (await db.table(table).get(row.id)) as LocalRow<SyncedTable> | undefined;
        if (local && local.client_updated_at > row.client_updated_at) {
          // a edição local ainda vai subir e vencerá (RN-97)
          skipped += 1;
          continue;
        }
      }
      if (table === 'transactions' && device !== null && isRemoteEdit(row, device)) {
        const before = (await db.table(table).get(row.id)) as LocalRow<SyncedTable> | undefined;
        if (
          before &&
          before.deleted_at === null &&
          before.client_updated_at !== row.client_updated_at
        ) {
          remoteEdits += 1;
        }
      }
      await db.table(table).put({ ...row, _pending: pending > 0 ? 1 : 0 });
      rows += 1;
    }
    await db.sync_state.put({ key: 'cursor', value: page.next ?? cursor });
  });
  return { rows, skipped, remoteEdits };
}

/** Edição viva que veio de outro aparelho (a linha nova não é exclusão nem escrita deste aparelho). */
function isRemoteEdit(row: LocalRow<SyncedTable>, device: string): boolean {
  return row.deleted_at === null && row.device_id !== null && row.device_id !== device;
}

/** Busca todas as páginas desde o cursor. Não lança: falhas de RPC ficam em `failure`. */
export async function pullChanges(
  db: OakDb,
  transport: SyncTransport,
  now: () => number = Date.now,
  device: string | null = null,
): Promise<PullSummary> {
  const summary: PullSummary = {
    pages: 0,
    rows: 0,
    skipped: 0,
    remoteEdits: 0,
    reset: false,
    failure: null,
  };
  let cursor = await readCursor(db);
  for (;;) {
    const sentAtMs = now();
    let page: PullPage;
    try {
      page = await callRpc<PullPage>(transport, 'sync_pull', {
        p_since: cursor,
        p_limit: PULL_LIMIT,
      });
      if (typeof page !== 'object' || page === null) {
        throw new RpcFailure('fatal', 'BAD_RESPONSE');
      }
    } catch (error) {
      summary.failure = error instanceof RpcFailure ? error : new RpcFailure('fatal', 'UNKNOWN');
      return summary;
    }
    if (page.server_time) {
      await recordServerTime(db, { serverTime: page.server_time, sentAtMs, receivedAtMs: now() });
    }
    if (page.reset_required) {
      if (summary.reset) {
        summary.failure = new RpcFailure('fatal', 'RESET_LOOP');
        return summary;
      }
      summary.reset = true;
      await resetLocalData(db);
      cursor = 0;
      continue;
    }
    summary.pages += 1;
    const applied = await applyPage(db, page, cursor, summary.reset ? null : device);
    summary.rows += applied.rows;
    summary.skipped += applied.skipped;
    summary.remoteEdits += applied.remoteEdits;
    cursor = page.next ?? cursor;
    if (!page.has_more) {
      return summary;
    }
  }
}

/** Expurgo local dos tombstones com mais de 30 dias e sem entrada na fila. Devolve quantos saíram. */
export async function purgeLocalTombstones(db: OakDb, nowMs: number = Date.now()): Promise<number> {
  const limit = new Date(nowMs - LOCAL_TOMBSTONE_DAYS * 86_400_000).toISOString();
  let removed = 0;
  await db.transaction('rw', [...SYNCED_TABLES, 'outbox'], async () => {
    for (const name of SYNCED_TABLES) {
      const table = db.table<LocalRow<SyncedTable>, string>(name);
      const old = await table
        .filter((row) => row.deleted_at !== null && row.deleted_at < limit && row._pending !== 1)
        .primaryKeys();
      await table.bulkDelete(old);
      removed += old.length;
    }
  });
  return removed;
}
