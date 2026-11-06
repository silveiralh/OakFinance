// Push (tech §4.5): outbox → `sync_push`, em lotes de 200 e até 10 lotes por ciclo. Sempre antes do pull.
import type { LocalRow, OakDb, OutboxEntry, SyncedTable } from '../db';
import { MapperError, parseRow } from '../mappers';
import { markDone, markRejected, requeue, takeBatch } from './outbox';
import { callRpc, RpcFailure, type SyncTransport } from './transport';

export const MAX_BATCHES = 10;

export type PushStatus = 'applied' | 'duplicate' | 'stale' | 'rejected';

export interface PushResult {
  mutation_id: string;
  status: PushStatus;
  code?: string | null;
  message?: string;
  row?: Record<string, unknown> | null;
  server_version?: number;
}

export interface PushSummary {
  batches: number;
  applied: number;
  stale: number;
  rejected: Array<{ table: SyncedTable; code: string }>;
  /** Falha que interrompeu o ciclo (as entradas do lote voltaram para `queued`). */
  failure: RpcFailure | null;
}

function isPushResponse(value: unknown): value is { results: PushResult[]; server_time?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { results?: unknown }).results)
  );
}

/** `stale`: o servidor tinha versão mais nova. Grava a linha dele, a não ser que haja outra edição local na fila. */
async function applyStale(db: OakDb, entry: OutboxEntry, row: unknown): Promise<void> {
  await db.transaction(
    'rw',
    db.tables.map((t) => t.name),
    async () => {
      await markDone(db, [entry.mutation_id]);
      const others = await db.outbox
        .where('[table+row_id]')
        .equals([entry.table, entry.row_id])
        .count();
      if (others === 0 && row) {
        try {
          const parsed = parseRow(entry.table, row) as LocalRow<SyncedTable>;
          await db.table(entry.table).put({ ...parsed, _pending: 0 });
        } catch (error) {
          if (!(error instanceof MapperError)) {
            throw error;
          }
          // linha do servidor fora do formato: o pull seguinte traz a versão certa
        }
      }
    },
  );
}

/** Um ciclo de push. Não lança: falhas de RPC ficam em `failure`. */
export async function pushOutbox(
  db: OakDb,
  transport: SyncTransport,
  deviceId: string,
  maxBatches: number = MAX_BATCHES,
): Promise<PushSummary> {
  const summary: PushSummary = { batches: 0, applied: 0, stale: 0, rejected: [], failure: null };
  while (summary.batches < maxBatches) {
    const batch = await takeBatch(db);
    if (batch.length === 0) {
      break;
    }
    summary.batches += 1;
    let response: unknown;
    try {
      response = await callRpc(transport, 'sync_push', {
        p_device_id: deviceId,
        p_mutations: batch.map((entry) => ({
          mutation_id: entry.mutation_id,
          table: entry.table,
          row: entry.row,
        })),
      });
      if (!isPushResponse(response)) {
        throw new RpcFailure('fatal', 'BAD_RESPONSE');
      }
    } catch (error) {
      await requeue(
        db,
        batch.map((entry) => entry.mutation_id),
      );
      summary.failure = error instanceof RpcFailure ? error : new RpcFailure('fatal', 'UNKNOWN');
      break;
    }
    const byId = new Map(batch.map((entry) => [entry.mutation_id, entry]));
    const done: string[] = [];
    for (const result of response.results) {
      const entry = byId.get(result.mutation_id);
      if (!entry) {
        continue;
      }
      byId.delete(result.mutation_id);
      if (result.status === 'applied' || result.status === 'duplicate') {
        done.push(entry.mutation_id);
        summary.applied += 1;
      } else if (result.status === 'stale') {
        await applyStale(db, entry, result.row);
        summary.stale += 1;
      } else {
        const code = result.code ?? 'REJECTED';
        await markRejected(db, entry.mutation_id, code);
        summary.rejected.push({ table: entry.table, code });
      }
    }
    await markDone(db, done);
    // resultado ausente: volta para a fila e fica para o próximo ciclo (sem reenviar em laço)
    if (byId.size > 0) {
      await requeue(db, [...byId.keys()]);
      break;
    }
  }
  return summary;
}
