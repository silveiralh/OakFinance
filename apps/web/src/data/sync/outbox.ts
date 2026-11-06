// Outbox (tech §4.4 [CONTRATO]): fila de linhas inteiras a enviar pelo `sync_push`. Coalescência só sobre
// entradas `queued`; `inflight` nunca é tocada (a nova gravação vira outra entrada).
import type { OakDb, OutboxEntry, SyncedTable } from '../db';
import { newId } from '../ids';

/** Máximo por chamada do `sync_push` (tech §4.5). */
export const PUSH_BATCH = 200;

export interface EnqueueInput {
  table: SyncedTable;
  rowId: string;
  row: Record<string, unknown>;
  createdAt: string;
}

/**
 * Coloca a linha na fila. Se já há entrada `queued` da mesma linha, troca o `row` e gera um `mutation_id` novo
 * (a anterior nunca foi enviada); a posição na fila (`seq`) fica. Chame dentro da transação da escrita.
 */
export async function enqueue(
  db: OakDb,
  { table, rowId, row, createdAt }: EnqueueInput,
  createId: () => string = newId,
): Promise<OutboxEntry> {
  const same = await db.outbox.where('[table+row_id]').equals([table, rowId]).toArray();
  const queued = same.find((entry) => entry.state === 'queued');
  if (queued?.seq !== undefined) {
    const updated: OutboxEntry = { ...queued, row, mutation_id: createId() };
    await db.outbox.put(updated);
    return updated;
  }
  const entry: OutboxEntry = {
    mutation_id: createId(),
    table,
    row_id: rowId,
    row,
    state: 'queued',
    attempts: 0,
    created_at: createdAt,
  };
  entry.seq = await db.outbox.add(entry);
  return entry;
}

/** Até `limit` entradas `queued`, na ordem de `seq`, marcadas como `inflight` (passo 3 do push). */
export async function takeBatch(db: OakDb, limit: number = PUSH_BATCH): Promise<OutboxEntry[]> {
  return db.transaction('rw', db.outbox, async () => {
    const batch = await db.outbox.where('state').equals('queued').sortBy('seq');
    const taken = batch.slice(0, limit).map((entry) => ({ ...entry, state: 'inflight' as const }));
    await db.outbox.bulkPut(taken);
    return taken;
  });
}

async function clearPending(db: OakDb, entry: OutboxEntry) {
  const others = await db.outbox
    .where('[table+row_id]')
    .equals([entry.table, entry.row_id])
    .count();
  if (others === 0) {
    await db.table(entry.table).update(entry.row_id, { _pending: 0 });
  }
}

/** `applied`/`duplicate`: sai da fila; a linha deixa de estar pendente se não houver outra entrada dela. */
export async function markDone(db: OakDb, mutationIds: readonly string[]): Promise<void> {
  if (mutationIds.length === 0) {
    return;
  }
  await db.transaction(
    'rw',
    [db.outbox, ...db.tables.filter((t) => t.name !== 'outbox')],
    async () => {
      const entries = await db.outbox
        .where('mutation_id')
        .anyOf([...mutationIds])
        .toArray();
      await db.outbox.bulkDelete(entries.map((entry) => entry.seq as number));
      for (const entry of entries) {
        await clearPending(db, entry);
      }
    },
  );
}

/** Falha de rede/5xx: volta para `queued` com `attempts + 1` (o backoff é do motor, T-033). */
export async function requeue(db: OakDb, mutationIds: readonly string[]): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const entries = await db.outbox
      .where('mutation_id')
      .anyOf([...mutationIds])
      .toArray();
    await db.outbox.bulkPut(
      entries.map((entry) => ({
        ...entry,
        state: 'queued' as const,
        attempts: entry.attempts + 1,
      })),
    );
  });
}

/** `rejected` (check, FK ou RLS): fica visível no Diagnóstico com o código do erro. */
export async function markRejected(db: OakDb, mutationId: string, code: string): Promise<void> {
  await db.outbox
    .where('mutation_id')
    .equals(mutationId)
    .modify((entry) => {
      entry.state = 'rejected';
      entry.last_error = code;
    });
}

/** Entradas ainda não enviadas (`queued` + `inflight`): o "Há N alterações…" do G16 e o SyncBadge. */
export function pendingCount(db: OakDb): Promise<number> {
  return db.outbox.where('state').anyOf(['queued', 'inflight']).count();
}

export function rejectedEntries(db: OakDb): Promise<OutboxEntry[]> {
  return db.outbox.where('state').equals('rejected').sortBy('seq');
}
