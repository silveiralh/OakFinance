// Gravação local (tech §4.1, RN-95): uma única transação Dexie faz o `put` da linha e põe a linha inteira na
// outbox, com `client_updated_at` do relógio híbrido e o `device_id` do aparelho. Exclusão é lógica (RN-99).
import type { LocalRow, OakDb, SyncedTable } from '../db';
import { toServerRow } from '../mappers';
import type { Result } from '../result';
import { writeLocal } from '../storage';
import { deviceId, hlcNow } from '../sync/clock';
import { enqueue } from '../sync/outbox';

/** Relógio de parede injetável nos testes. */
export interface WriteOptions {
  nowMs?: number;
}

/** Tabelas da transação de escrita: as da linha (e da cascata), `outbox` e `sync_state`. */
function scope(tables: readonly SyncedTable[]): string[] {
  return [...new Set(tables), 'outbox', 'sync_state'];
}

/**
 * Grava a linha dentro de uma transação já aberta (com a tabela, `outbox` e `sync_state` no escopo). Usado pelas
 * cascatas para que tudo entre na mesma transação, como mutações separadas.
 */
export async function putInTransaction<T extends SyncedTable>(
  db: OakDb,
  table: T,
  row: LocalRow<T>,
  device: string,
  nowMs: number,
): Promise<LocalRow<T>> {
  const stamped = {
    ...row,
    client_updated_at: await hlcNow(db, nowMs),
    device_id: device,
    _pending: 1,
  } as LocalRow<T>;
  await db.table(table).put(stamped);
  await enqueue(db, {
    table,
    rowId: row.id,
    row: toServerRow(stamped),
    createdAt: new Date(nowMs).toISOString(),
  });
  return stamped;
}

/** Cria ou edita uma linha (sempre a linha inteira, nunca um patch). */
export async function saveRow<T extends SyncedTable>(
  db: OakDb,
  table: T,
  row: LocalRow<T>,
  { nowMs = Date.now() }: WriteOptions = {},
): Promise<Result<LocalRow<T>>> {
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction('rw', scope([table]), () => putInTransaction(db, table, row, device, nowMs)),
  );
}

/** Exclusão lógica: `deleted_at` preenchido, sincronizada como qualquer edição. Linha ausente devolve `null`. */
export async function deleteRow<T extends SyncedTable>(
  db: OakDb,
  table: T,
  id: string,
  { nowMs = Date.now() }: WriteOptions = {},
): Promise<Result<LocalRow<T> | null>> {
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction('rw', scope([table]), async () => {
      const current = (await db.table(table).get(id)) as LocalRow<T> | undefined;
      if (!current || current.deleted_at !== null) {
        return current ?? null;
      }
      return putInTransaction(
        db,
        table,
        { ...current, deleted_at: new Date(nowMs).toISOString() } as LocalRow<T>,
        device,
        nowMs,
      );
    }),
  );
}

/** "Desfazer" do toast de exclusão (RN-99, 8 s): limpa o `deleted_at`. */
export async function restoreRow<T extends SyncedTable>(
  db: OakDb,
  table: T,
  id: string,
  { nowMs = Date.now() }: WriteOptions = {},
): Promise<Result<LocalRow<T> | null>> {
  const device = await deviceId(db);
  return writeLocal(() =>
    db.transaction('rw', scope([table]), async () => {
      const current = (await db.table(table).get(id)) as LocalRow<T> | undefined;
      if (!current || current.deleted_at === null) {
        return current ?? null;
      }
      return putInTransaction(
        db,
        table,
        { ...current, deleted_at: null } as LocalRow<T>,
        device,
        nowMs,
      );
    }),
  );
}

export { scope as writeScope };
