import {
  DEFAULT_CATEGORIES,
  DEFAULT_REMINDERS,
  DEFAULT_RULES,
  reserveGoalId,
  seedCategoryId,
} from '@oakfinance/domain';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { OakDb } from '../../src/data/db';
import { parseRow } from '../../src/data/mappers';
import { ensureSeeds, seedBudgetId, seedRows } from '../../src/data/seeds';

const USER = '0f000000-0000-4000-8000-000000000001';
const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);
const opened: OakDb[] = [];
function open(name = USER) {
  const db = new OakDb(`${name}-${opened.length}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const TOTAL = DEFAULT_CATEGORIES.length + DEFAULT_RULES.length + DEFAULT_REMINDERS.length + 3 + 1;

describe('seeds por usuário (tech §3.8, RN-40, RN-64)', () => {
  it('RN-40/RN-64: categorias, regras, lembretes, orçamento 5000/3000/2000 e reserva, numa transação', async () => {
    const db = open();
    expect(await ensureSeeds(db, USER, { nowMs: T0 })).toEqual({ ok: true, value: TOTAL });
    expect(await db.categories.count()).toBe(31);
    expect(await db.category_rules.count()).toBe(DEFAULT_RULES.length);
    expect(await db.reminders.count()).toBe(9);
    const budgets = await db.budgets.toArray();
    expect(Object.fromEntries(budgets.map((b) => [b.bucket, b.pct_bp]))).toEqual({
      needs: 5000,
      wants: 3000,
      savings: 2000,
    });
    expect(budgets.every((b) => b.month === null && b.scope === 'bucket')).toBe(true);
    expect(await db.goals.get(reserveGoalId(USER))).toMatchObject({
      kind: 'emergency_reserve',
      target_mode: 'auto',
      auto_factor: 6,
      auto_lookback_months: 6,
    });
    const rule = await db.category_rules
      .where('category_id')
      .equals(seedCategoryId(USER, 'combustivel'))
      .first();
    expect(rule).toMatchObject({ match_type: 'token_prefix', source: 'default', _pending: 1 });
    expect(await db.outbox.count()).toBe(TOTAL);
    const order = (await db.outbox.orderBy('seq').toArray()).map((e) => e.table);
    expect(order.indexOf('category_rules')).toBeGreaterThan(order.lastIndexOf('categories'));
  });

  it('US-01: idempotente — rodar de novo (relogar, outro aparelho) não duplica', async () => {
    const db = open();
    await ensureSeeds(db, USER, { nowMs: T0 });
    expect(await ensureSeeds(db, USER, { nowMs: T0 + 1000 })).toEqual({ ok: true, value: 0 });
    expect(await db.categories.count()).toBe(31);
    const other = open();
    await ensureSeeds(other, USER, { nowMs: T0 });
    expect((await other.categories.toArray()).map((c) => c.id).sort()).toEqual(
      (await db.categories.toArray()).map((c) => c.id).sort(),
    );
  });

  it('seed apagado pelo usuário (tombstone) não é recriado; o que falta é', async () => {
    const db = open();
    await ensureSeeds(db, USER, { nowMs: T0 });
    const mercado = seedCategoryId(USER, 'mercado');
    await db.categories.update(mercado, { deleted_at: '2026-11-06T13:00:00.000Z' });
    await db.reminders.delete((await db.reminders.toCollection().first())?.id ?? '');
    expect(await ensureSeeds(db, USER, { nowMs: T0 + 1000 })).toEqual({ ok: true, value: 1 });
    expect((await db.categories.get(mercado))?.deleted_at).toBe('2026-11-06T13:00:00.000Z');
  });

  it('ids determinísticos por usuário; linhas no formato das colunas do Postgres', () => {
    expect(seedBudgetId(USER, 'needs')).toBe(seedBudgetId(USER, 'needs'));
    expect(seedBudgetId(USER, 'needs')).not.toBe(seedBudgetId(USER, 'wants'));
    expect(seedBudgetId(USER, 'needs')).not.toBe(seedBudgetId('outro', 'needs'));
    for (const { table, row } of seedRows(USER, '2026-11-06T12:00:00.000Z')) {
      expect(() => parseRow(table, row), `${table} ${row.id}`).not.toThrow();
    }
  });
});
