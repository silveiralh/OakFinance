import { Dexie } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OakDb } from '../../src/data/db';
import { deleteCard, deleteReceipt, deleteSeries } from '../../src/data/repositories/cascade';
import { deleteRow, restoreRow, saveRow } from '../../src/data/repositories/rows';
import { getStorageStatus, resetStorageStatus } from '../../src/data/storage';
import { makeRow, tx } from './rows';

const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`repo-${opened.length}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  resetStorageStatus();
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

describe('repositórios (RN-95, RN-97, RN-99)', () => {
  it('RN-95: salvar grava a linha e a mutação na mesma transação, com HLC, device_id e _pending', async () => {
    const db = open();
    const saved = await saveRow(db, 'transactions', tx('t1', { amount_cents: 4590 }), {
      nowMs: T0,
    });
    expect(saved.ok).toBe(true);
    const row = await db.transactions.get('t1');
    expect(row).toMatchObject({
      amount_cents: 4590,
      client_updated_at: '2026-11-06T12:00:00.000Z',
      _pending: 1,
    });
    expect(row?.device_id).toBe((await db.sync_state.get('device_id'))?.value);
    const [entry] = await db.outbox.toArray();
    expect(entry).toMatchObject({
      table: 'transactions',
      row_id: 't1',
      state: 'queued',
      attempts: 0,
    });
    expect(entry?.row).not.toHaveProperty('_pending');
    expect(entry?.row).toMatchObject({ amount_cents: 4590, device_id: row?.device_id });
  });

  it('RN-97: edições seguidas ganham client_updated_at crescente e coalescem na outbox', async () => {
    const db = open();
    await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    await saveRow(db, 'transactions', tx('t1', { amount_cents: 2000 }), { nowMs: T0 });
    const row = await db.transactions.get('t1');
    expect(row?.client_updated_at).toBe('2026-11-06T12:00:00.001Z');
    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.row).toMatchObject({ amount_cents: 2000 });
  });

  it('falha na transação não deixa linha sem mutação (atomicidade)', async () => {
    const db = open();
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('falhou'));
    const result = await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_FAILED' } });
    expect(await db.transactions.get('t1')).toBeUndefined();
  });

  it('US-64: sem espaço, a escrita volta STORAGE_QUOTA e liga o G11', async () => {
    const db = open();
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(
      new DOMException('cheio', 'QuotaExceededError'),
    );
    const result = await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    expect(result).toMatchObject({ ok: false, error: { code: 'STORAGE_QUOTA' } });
    expect(getStorageStatus().full).toBe(true);
  });

  it('RN-99: excluir é lógico e sincroniza; desfazer restaura', async () => {
    const db = open();
    await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    const removed = await deleteRow(db, 'transactions', 't1', { nowMs: T0 + 1000 });
    expect(removed).toMatchObject({ ok: true, value: { deleted_at: '2026-11-06T12:00:01.000Z' } });
    expect((await db.outbox.toArray())[0]?.row).toMatchObject({
      deleted_at: '2026-11-06T12:00:01.000Z',
    });
    expect(await deleteRow(db, 'transactions', 't1', { nowMs: T0 + 2000 })).toMatchObject({
      value: { deleted_at: '2026-11-06T12:00:01.000Z' },
    });
    const restored = await restoreRow(db, 'transactions', 't1', { nowMs: T0 + 3000 });
    expect(restored).toMatchObject({ ok: true, value: { deleted_at: null } });
    expect(await restoreRow(db, 'transactions', 't1')).toMatchObject({
      value: { deleted_at: null },
    });
    expect(await deleteRow(db, 'transactions', 'nao-existe')).toEqual({ ok: true, value: null });
    expect(await restoreRow(db, 'transactions', 'nao-existe')).toEqual({ ok: true, value: null });
  });

  it('cascata: excluir o cartão exclui faturas e transações dele, cada uma como mutação', async () => {
    const db = open();
    await db.cards.bulkPut([makeRow('cards', { id: 'c1' }), makeRow('cards', { id: 'c2' })]);
    await db.invoices.bulkPut([
      makeRow('invoices', { id: 'i1', card_id: 'c1' }),
      makeRow('invoices', { id: 'i2', card_id: 'c2' }),
    ]);
    await db.transactions.bulkPut([
      tx('t1', { card_id: 'c1' }),
      tx('t2', { card_id: 'c1', deleted_at: '2026-11-01T00:00:00.000Z' }),
      tx('t3', { card_id: 'c2' }),
    ]);
    expect(await deleteCard(db, 'c1', { nowMs: T0 })).toEqual({ ok: true, value: 3 });
    const outbox = await db.outbox.orderBy('seq').toArray();
    expect(outbox.map((e) => `${e.table}:${e.row_id}`)).toEqual([
      'transactions:t1',
      'invoices:i1',
      'cards:c1',
    ]);
    expect((await db.transactions.get('t3'))?.deleted_at).toBeNull();
    expect((await db.invoices.get('i2'))?.deleted_at).toBeNull();
  });

  it('cascata: série → parcelas e recibo → itens', async () => {
    const db = open();
    await db.installment_plans.put(makeRow('installment_plans', { id: 's1' }));
    await db.transactions.bulkPut([tx('p1', { series_id: 's1' }), tx('p2', { series_id: 's1' })]);
    expect(await deleteSeries(db, 's1', { nowMs: T0 })).toEqual({ ok: true, value: 3 });
    await db.nfce_receipts.put(makeRow('nfce_receipts', { id: 'r1' }));
    await db.receipt_items.bulkPut([
      makeRow('receipt_items', { id: 'n1', receipt_id: 'r1' }),
      makeRow('receipt_items', { id: 'n2', receipt_id: 'r1' }),
    ]);
    expect(await deleteReceipt(db, 'r1', { nowMs: T0 })).toEqual({ ok: true, value: 3 });
    expect((await db.receipt_items.get('n2'))?.deleted_at).toBe('2026-11-06T12:00:00.000Z');
    expect(await deleteReceipt(db, 'nao-existe', { nowMs: T0 })).toEqual({ ok: true, value: 0 });
  });
});
