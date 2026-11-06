// Motor de sync do cliente contra o Supabase local (tech §8.2, §4.10): dois aparelhos do mesmo usuário, cada um
// com o próprio Dexie (fake-indexeddb), mais um segundo usuário para o isolamento. US-04, RN-96..RN-99.
import 'fake-indexeddb/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Dexie } from 'dexie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LocalRow, OakDb } from '../../src/data/db';
import { deleteRow, saveRow } from '../../src/data/repositories/rows';
import { SyncEngine } from '../../src/data/sync/engine';
import { fromSupabase } from '../../src/data/sync/transport';

const API_URL = process.env.API_URL ?? '';
const ADMIN_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY ?? '';
const CLIENT_KEY = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY ?? '';
const PASSWORD = 'senha-local-de-teste-123';

let admin: SupabaseClient;
const dbs: OakDb[] = [];

let seq = 0;
function uuid(prefix: string): string {
  seq += 1;
  return `${prefix.padEnd(8, '0')}-0000-4000-9000-${seq.toString(16).padStart(12, '0')}`;
}

function account(id: string): LocalRow<'accounts'> {
  return {
    id,
    name: `Conta ${id.slice(-4)}`,
    type: 'checking',
    initial_balance_cents: 0,
    initial_balance_on: '2026-11-01',
    is_restricted: false,
    include_in_spendable: true,
    sort_order: 0,
  } as unknown as LocalRow<'accounts'>;
}

function expense(id: string, accountId: string, cents: number): LocalRow<'transactions'> {
  return {
    id,
    kind: 'expense',
    status: 'posted',
    amount_cents: cents,
    occurred_on: '2026-11-05',
    payment_method: 'pix',
    account_id: accountId,
    category_source: 'manual',
    invoice_pinned: false,
    income_expected: false,
    count_before_received: false,
    source: 'manual',
    review_state: 'ok',
    matched_external: false,
    tags: [],
    deleted_at: null,
  } as unknown as LocalRow<'transactions'>;
}

async function ensureUser(email: string): Promise<void> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) {
    return;
  }
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) {
    throw new Error(`createUser ${email}: ${error.message}`);
  }
}

async function device(email: string, name: string) {
  const client = createClient(API_URL, CLIENT_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) {
    throw new Error(`signIn ${email}: ${error.message}`);
  }
  const db = new OakDb(`int-${name}-${Date.now()}`);
  dbs.push(db);
  const engine = new SyncEngine({
    db,
    transport: fromSupabase(client),
    isOnline: () => true,
    isVisible: () => false,
  });
  return { client, db, engine };
}

let a1: Awaited<ReturnType<typeof device>>;
let a2: Awaited<ReturnType<typeof device>>;
let b1: Awaited<ReturnType<typeof device>>;

beforeAll(async () => {
  expect(API_URL, 'API_URL de supabase status').not.toBe('');
  admin = createClient(API_URL, ADMIN_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await ensureUser('e2e-a@example.test');
  await ensureUser('e2e-b@example.test');
  a1 = await device('e2e-a@example.test', 'a1');
  a2 = await device('e2e-a@example.test', 'a2');
  b1 = await device('e2e-b@example.test', 'b1');
  // cada aparelho começa do zero: baixa o que já existe do usuário
  for (const d of [a1, a2, b1]) {
    expect(await d.engine.syncNow()).toMatchObject({ ok: true });
  }
});

afterAll(async () => {
  for (const db of dbs) {
    db.close();
    await Dexie.delete(db.name);
  }
});

describe('motor de sync do cliente com dois aparelhos (Supabase local)', () => {
  const conta = uuid('ca');
  const gasto = uuid('cb');

  it('US-04: o que um aparelho lança offline chega ao outro depois do sync', async () => {
    expect((await saveRow(a1.db, 'transactions', expense(gasto, conta, 1990))).ok).toBe(true);
    expect((await saveRow(a1.db, 'accounts', account(conta))).ok).toBe(true);
    // pai depois do filho na fila: o push_order do servidor aplica a conta primeiro (§4.10)
    expect(await a1.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a1.db.outbox.count()).toBe(0);
    expect((await a1.db.transactions.get(gasto))?._pending).toBe(0);

    expect(await a2.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a2.db.transactions.get(gasto)).toMatchObject({ amount_cents: 1990, _pending: 0 });
    expect(await a2.db.accounts.get(conta)).toMatchObject({ id: conta });
  });

  it('RN-97: edição offline nos dois aparelhos — a mais recente vence e o perdedor recebe a versão dela', async () => {
    const base = (await a1.db.transactions.get(gasto)) as LocalRow<'transactions'>;
    const t1 = Date.now();
    await saveRow(a1.db, 'transactions', { ...base, amount_cents: 2500 }, { nowMs: t1 });
    await saveRow(a2.db, 'transactions', { ...base, amount_cents: 3100 }, { nowMs: t1 + 2_000 });
    expect(await a2.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a1.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a1.db.transactions.get(gasto)).toMatchObject({ amount_cents: 3100, _pending: 0 });
    expect(await a1.db.outbox.count()).toBe(0);

    const { data: history, error } = await a1.client.rpc('get_row_history', {
      p_table: 'transactions',
      p_row_id: gasto,
    });
    expect(error).toBeNull();
    expect(JSON.stringify(history)).toContain('stale_write');
  });

  it('RN-99: exclusão lógica sincroniza e o outro aparelho fica com o tombstone', async () => {
    expect((await deleteRow(a2.db, 'transactions', gasto)).ok).toBe(true);
    expect(await a2.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a1.engine.syncNow()).toMatchObject({ ok: true });
    expect((await a1.db.transactions.get(gasto))?.deleted_at).not.toBeNull();
  });

  it('isolamento: o outro usuário não recebe nada do primeiro', async () => {
    expect(await b1.engine.syncNow()).toMatchObject({ ok: true });
    expect(await b1.db.transactions.get(gasto)).toBeUndefined();
    expect(await b1.db.accounts.get(conta)).toBeUndefined();
  });

  it('rejeitada (FK de outro usuário) fica na fila como rejected e não trava o resto', async () => {
    const alheia = uuid('cc');
    await saveRow(b1.db, 'transactions', expense(alheia, conta, 500));
    const minha = uuid('cd');
    await saveRow(b1.db, 'accounts', account(minha));
    expect(await b1.engine.syncNow()).toMatchObject({ ok: true });
    const outbox = await b1.db.outbox.toArray();
    expect(outbox).toEqual([expect.objectContaining({ row_id: alheia, state: 'rejected' })]);
    expect(b1.engine.getSnapshot().rejected).toBe(1);
    expect((await b1.db.accounts.get(minha))?._pending).toBe(0);
  });
});
