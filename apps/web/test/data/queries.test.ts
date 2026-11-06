import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { OakDb } from '../../src/data/db';
import {
  countsInTotals,
  isLive,
  listedTransactions,
  liveRows,
  transactionsForTotals,
} from '../../src/data/queries';
import { makeRow, tx } from './rows';

const opened: OakDb[] = [];
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

async function seeded() {
  const db = new OakDb('queries');
  opened.push(db);
  await db.transactions.bulkPut([
    tx('ok', { occurred_on: '2026-11-03' }),
    tx('novo', { occurred_on: '2026-11-04', review_state: 'new' }),
    tx('excluido', { deleted_at: '2026-11-05T10:00:00.000Z' }),
    tx('cancelado', { status: 'cancelled' }),
    tx('vinculado', { review_state: 'merged' }),
    tx('ignorado', { review_state: 'ignored' }),
    tx('sugerido', { review_state: 'suggested' }),
    tx('outro-mes', { occurred_on: '2026-10-31' }),
    tx('ultimo-dia', { occurred_on: '2026-11-30' }),
  ]);
  return db;
}

describe('leituras filtradas (tech §4.2, RN-05, RN-67)', () => {
  it('listas: nada excluído aparece; o resto do período sim, em ordem de data', async () => {
    const db = await seeded();
    const ids = (await listedTransactions(db, '2026-11-01', '2026-11-30')).map((row) => row.id);
    expect(ids).not.toContain('excluido');
    expect(ids).not.toContain('outro-mes');
    expect(ids.slice(0, 2)).toEqual(['ok', 'novo']);
    expect(ids).toEqual(expect.arrayContaining(['cancelado', 'sugerido', 'ultimo-dia']));
  });

  it('RN-67: agregados ignoram excluído, cancelado, vinculado, ignorado e sugestão pendente', async () => {
    const db = await seeded();
    const ids = (await transactionsForTotals(db, '2026-11-01', '2026-11-30'))
      .map((row) => row.id)
      .sort();
    expect(ids).toEqual(['novo', 'ok', 'ultimo-dia']);
  });

  it('liveRows serve qualquer tabela sincronizada', async () => {
    const db = await seeded();
    await db.cards.bulkPut([
      makeRow('cards', { id: 'c1' }),
      makeRow('cards', { id: 'c2', deleted_at: '2026-11-05T10:00:00.000Z' }),
    ]);
    expect((await liveRows(db, 'cards')).map((row) => row.id)).toEqual(['c1']);
  });

  it('predicados puros', () => {
    expect(isLive({ deleted_at: null })).toBe(true);
    expect(isLive({ deleted_at: '2026-11-05T10:00:00.000Z' })).toBe(false);
    expect(countsInTotals({ deleted_at: null, status: 'pending', review_state: 'ok' })).toBe(true);
    expect(countsInTotals({ deleted_at: null, status: 'posted', review_state: 'suggested' })).toBe(
      false,
    );
  });
});
