import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { OakDb } from '../../src/data/db';
import {
  enqueue,
  markDone,
  markRejected,
  PUSH_BATCH,
  pendingCount,
  rejectedEntries,
  requeue,
  takeBatch,
} from '../../src/data/sync/outbox';
import { tx } from './rows';

const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`outbox-${opened.length}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

let counter = 0;
const nextId = () => {
  counter += 1;
  return `m${counter}`;
};
const at = '2026-11-06T12:00:00.000Z';

describe('outbox (tech §4.4)', () => {
  it('coalescência: nova gravação da mesma linha queued troca o row e o mutation_id, mantendo o seq', async () => {
    const db = open();
    const first = await enqueue(
      db,
      { table: 'transactions', rowId: 't1', row: { v: 1 }, createdAt: at },
      nextId,
    );
    await enqueue(db, { table: 'transactions', rowId: 't2', row: { v: 1 }, createdAt: at }, nextId);
    const second = await enqueue(
      db,
      { table: 'transactions', rowId: 't1', row: { v: 2 }, createdAt: at },
      nextId,
    );
    expect(second.seq).toBe(first.seq);
    expect(second.mutation_id).not.toBe(first.mutation_id);
    const all = await db.outbox.orderBy('seq').toArray();
    expect(all.map((e) => [e.row_id, e.row])).toEqual([
      ['t1', { v: 2 }],
      ['t2', { v: 1 }],
    ]);
  });

  it('entrada inflight não é tocada: a nova gravação vira outra entrada', async () => {
    const db = open();
    await enqueue(db, { table: 'cards', rowId: 'c1', row: { v: 1 }, createdAt: at }, nextId);
    const [inflight] = await takeBatch(db);
    await enqueue(db, { table: 'cards', rowId: 'c1', row: { v: 2 }, createdAt: at }, nextId);
    const all = await db.outbox.orderBy('seq').toArray();
    expect(all.map((e) => [e.state, e.row])).toEqual([
      ['inflight', { v: 1 }],
      ['queued', { v: 2 }],
    ]);
    expect(all[0]?.mutation_id).toBe(inflight?.mutation_id);
    expect(await pendingCount(db)).toBe(2);
  });

  it('takeBatch: até 200 por vez, na ordem do seq, marcadas inflight', async () => {
    const db = open();
    for (let i = 0; i < PUSH_BATCH + 5; i += 1) {
      await enqueue(db, { table: 'transactions', rowId: `t${i}`, row: {}, createdAt: at }, nextId);
    }
    const batch = await takeBatch(db);
    expect(batch).toHaveLength(PUSH_BATCH);
    expect(batch[0]?.row_id).toBe('t0');
    expect(batch.every((e) => e.state === 'inflight')).toBe(true);
    expect(await takeBatch(db, 10)).toHaveLength(5);
    expect(await takeBatch(db)).toHaveLength(0);
  });

  it('markDone tira da fila e limpa _pending só quando não sobra entrada da linha', async () => {
    const db = open();
    await db.transactions.bulkPut([tx('t1', { _pending: 1 }), tx('t2', { _pending: 1 })]);
    await enqueue(db, { table: 'transactions', rowId: 't1', row: {}, createdAt: at }, nextId);
    await enqueue(db, { table: 'transactions', rowId: 't2', row: {}, createdAt: at }, nextId);
    const batch = await takeBatch(db);
    await enqueue(db, { table: 'transactions', rowId: 't2', row: { v: 2 }, createdAt: at }, nextId);
    await markDone(
      db,
      batch.map((e) => e.mutation_id),
    );
    expect((await db.transactions.get('t1'))?._pending).toBe(0);
    expect((await db.transactions.get('t2'))?._pending).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    await markDone(db, []);
    expect(await db.outbox.count()).toBe(1);
  });

  it('requeue volta para queued com attempts + 1; markRejected guarda o código', async () => {
    const db = open();
    await enqueue(db, { table: 'transactions', rowId: 't1', row: {}, createdAt: at }, nextId);
    await enqueue(db, { table: 'transactions', rowId: 't2', row: {}, createdAt: at }, nextId);
    const [a, b] = await takeBatch(db);
    await requeue(db, [a?.mutation_id ?? '']);
    await markRejected(db, b?.mutation_id ?? '', '23503');
    const again = await db.outbox.get(a?.seq ?? 0);
    expect(again).toMatchObject({ state: 'queued', attempts: 1 });
    expect(await rejectedEntries(db)).toEqual([
      expect.objectContaining({ row_id: 't2', state: 'rejected', last_error: '23503' }),
    ]);
    expect(await pendingCount(db)).toBe(1);
  });
});
