// Receita fixa com dois aparelhos contra o Supabase local (US-23, RN-27, RN-97): os dois confirmam a mesma ocorrência
// offline; depois do sync existe uma única linha (recorrência, data), com o id v5, e a última edição vence.
import 'fake-indexeddb/auto';
import { recurrenceTxId } from '@oakfinance/domain';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Dexie } from 'dexie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LocalRow, OakDb } from '../../src/data/db';
import { newId } from '../../src/data/ids';
import { saveRow } from '../../src/data/repositories/rows';
import { SyncEngine } from '../../src/data/sync/engine';
import { fromSupabase } from '../../src/data/sync/transport';
import {
  buildFixedIncome,
  confirmOccurrence,
  recurrenceFromRow,
} from '../../src/features/recurrences/model';

const API_URL = process.env.API_URL ?? '';
const ADMIN_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY ?? '';
const CLIENT_KEY = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY ?? '';
const PASSWORD = 'senha-local-de-teste-123';
const EMAIL = 'e2e-a@example.test';

const dbs: OakDb[] = [];

async function ensureUser(admin: SupabaseClient): Promise<void> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (list?.users.some((u) => u.email === EMAIL)) {
    return;
  }
  const { error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) {
    throw new Error(`createUser: ${error.message}`);
  }
}

async function device(name: string) {
  const client = createClient(API_URL, CLIENT_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error || !data.user) {
    throw new Error(`signIn: ${error?.message}`);
  }
  const db = new OakDb(`int-rec-${name}-${Date.now()}`);
  dbs.push(db);
  const engine = new SyncEngine({
    db,
    transport: fromSupabase(client),
    isOnline: () => true,
    isVisible: () => false,
  });
  return { client, db, engine, userId: data.user.id };
}

let a1: Awaited<ReturnType<typeof device>>;
let a2: Awaited<ReturnType<typeof device>>;

beforeAll(async () => {
  expect(API_URL, 'API_URL de supabase status').not.toBe('');
  await ensureUser(
    createClient(API_URL, ADMIN_KEY, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
  a1 = await device('a1');
  a2 = await device('a2');
  for (const d of [a1, a2]) {
    expect(await d.engine.syncNow()).toMatchObject({ ok: true });
  }
});

afterAll(async () => {
  for (const db of dbs) {
    db.close();
    await Dexie.delete(db.name);
  }
});

describe('receita fixa com dois aparelhos (Supabase local)', () => {
  it('US-23: os dois confirmam 05/12/2026 offline → uma única linha com o id v5 e a última edição vence', async () => {
    const accountId = newId();
    const now = new Date().toISOString();
    await saveRow(a1.db, 'accounts', {
      id: accountId,
      user_id: a1.userId,
      name: `Conta renda ${accountId.slice(-6)}`,
      type: 'checking',
      initial_balance_cents: 0,
      initial_balance_on: '2026-11-01',
      is_restricted: false,
      include_in_spendable: true,
      sort_order: 0,
      archived_at: null,
      color: null,
      icon: null,
      institution: null,
      deleted_at: null,
      created_at: now,
      updated_at: now,
      server_version: 0,
      client_updated_at: now,
      device_id: null,
    } satisfies LocalRow<'accounts'>);
    const recRow = buildFixedIncome({
      userId: a1.userId,
      description: 'Salário',
      amountCents: 500_000,
      dayOfMonth: 5,
      accountId,
      categoryId: null,
      startOn: '2026-11-01',
      nowIso: now,
    });
    expect((await saveRow(a1.db, 'recurrences', recRow)).ok).toBe(true);
    expect(await a1.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a2.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a2.db.recurrences.get(recRow.id)).toMatchObject({ id: recRow.id });

    const rec = recurrenceFromRow(recRow);
    if (!rec) {
      throw new Error('recorrência inválida');
    }
    const t0 = Date.now();
    await confirmOccurrence(a1.db, a1.userId, rec, '2026-12-05', 500_000, t0);
    await confirmOccurrence(a2.db, a2.userId, rec, '2026-12-05', 487_000, t0 + 2_000);
    expect(await a1.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a2.engine.syncNow()).toMatchObject({ ok: true });
    expect(await a1.engine.syncNow()).toMatchObject({ ok: true });

    const id = recurrenceTxId(rec.id, '2026-12-05');
    const { data, error } = await a1.client
      .from('transactions')
      .select('id, amount_cents, status')
      .eq('recurrence_id', rec.id)
      .eq('recurrence_date', '2026-12-05');
    expect(error).toBeNull();
    expect(data).toEqual([{ id, amount_cents: 487_000, status: 'posted' }]);
    expect(await a1.db.transactions.get(id)).toMatchObject({ amount_cents: 487_000, _pending: 0 });
    expect(await a2.db.transactions.get(id)).toMatchObject({ amount_cents: 487_000, _pending: 0 });
    expect(await a1.db.outbox.count()).toBe(0);
    expect(await a2.db.outbox.count()).toBe(0);
  });
});
