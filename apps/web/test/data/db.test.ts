import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { dbName, deleteUserDb, OakDb, SYNCED_TABLES } from '../../src/data/db';
import { tx } from './rows';

const here = dirname(fileURLToPath(import.meta.url));
const tech = readFileSync(join(here, '../../../../docs/specs/02-tech-spec.md'), 'utf8');

/** `stores({...})` literal da tech §4.2 [CONTRATO]. */
function specStores(): Record<string, string> {
  const section = tech.slice(tech.indexOf('### 4.2 '), tech.indexOf('### 4.3 '));
  const out: Record<string, string> = {};
  for (const match of section.matchAll(/^\s+([a-z_]+): '([^']+)',/gm)) {
    out[match[1] ?? ''] = match[2] ?? '';
  }
  return out;
}

const opened: OakDb[] = [];
function open(userId: string) {
  const db = new OakDb(userId);
  opened.push(db);
  return db;
}

afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

describe('Dexie v1 (tech §4.2)', () => {
  it('um banco por usuário: oakfinance_<userId>', () => {
    expect(dbName('u1')).toBe('oakfinance_u1');
    expect(open('u1').name).toBe('oakfinance_u1');
  });

  it('tabelas e índices iguais ao schema literal da tech §4.2', async () => {
    const db = open('schema');
    await db.open();
    const spec = specStores();
    expect(Object.keys(spec)).toHaveLength(22);
    const actual: Record<string, string> = {};
    for (const table of db.tables) {
      const { primKey, indexes } = table.schema;
      actual[table.name] = [primKey.src, ...indexes.map((index) => index.src)].join(', ');
    }
    expect(actual).toEqual(spec);
    expect(db.verno).toBe(1);
    expect([...SYNCED_TABLES, 'outbox', 'sync_state', 'kv'].sort()).toEqual(
      Object.keys(spec).sort(),
    );
  });

  it('bancos de usuários diferentes não se misturam e o logout apaga o do usuário (RN-100)', async () => {
    const a = open('a');
    const b = open('b');
    await a.transactions.put(tx('t1'));
    expect(await a.transactions.count()).toBe(1);
    expect(await b.transactions.count()).toBe(0);
    a.close();
    await deleteUserDb('a');
    expect(await Dexie.exists('oakfinance_a')).toBe(false);
    expect(await Dexie.exists('oakfinance_b')).toBe(true);
  });

  it('outbox: seq automático e mutation_id único', async () => {
    const db = open('outbox');
    const entry = {
      mutation_id: 'm1',
      table: 'transactions' as const,
      row_id: 't1',
      row: { id: 't1' },
      state: 'queued' as const,
      attempts: 0,
      created_at: '2026-11-06T12:00:00.000Z',
    };
    const seq = await db.outbox.add(entry);
    expect(seq).toBe(1);
    await expect(db.outbox.add({ ...entry })).rejects.toThrow();
    expect(await db.outbox.where('[table+row_id]').equals(['transactions', 't1']).count()).toBe(1);
  });
});
