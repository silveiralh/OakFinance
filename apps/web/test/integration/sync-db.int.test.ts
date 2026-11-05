// Sync ponta a ponta contra o Supabase local (tech §8.2 e §4.10). US-04, US-05, RN-96..RN-99.
// Dois usuários reais criados pela Admin API (e-mails @example.test da allowlist do seed.sql).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API_URL = process.env.API_URL ?? '';
const ADMIN_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY ?? '';
const CLIENT_KEY = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY ?? '';
const DB_URL = process.env.DB_URL ?? '';
const PASSWORD = 'senha-local-de-teste-123';

type Json = Record<string, unknown>;

interface PushResult {
  mutation_id: string;
  status: 'applied' | 'duplicate' | 'stale' | 'rejected';
  code?: string;
  row?: Json;
  server_version?: number;
}

interface PullResult {
  rows: { t: string; v: number; r: Json }[];
  next: number;
  has_more: boolean;
  reset_required?: boolean;
}

let admin: SupabaseClient;
let db: pg.Client;
let userA: string;
let userB: string;
let a1: SupabaseClient;
let a2: SupabaseClient;
let b1: SupabaseClient;

let seq = 0;
/** UUID com prefixo legível e sufixo sequencial (determinístico por execução). */
function uuid(prefix: string): string {
  seq += 1;
  return `${prefix.padEnd(8, '0')}-0000-4000-8000-${seq.toString(16).padStart(12, '0')}`;
}

function account(id: string, clientUpdatedAt: string, extra: Json = {}): Json {
  return {
    id,
    name: 'Conta',
    type: 'checking',
    initial_balance_cents: 0,
    initial_balance_on: '2026-11-01',
    is_restricted: false,
    include_in_spendable: true,
    sort_order: 0,
    client_updated_at: clientUpdatedAt,
    ...extra,
  };
}

function expense(id: string, accountId: string, cents: number): Json {
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
    client_updated_at: new Date().toISOString(),
  };
}

async function push(
  client: SupabaseClient,
  device: string,
  muts: { table: string; row: Json; id?: string }[],
) {
  const { data, error } = await client.rpc('sync_push', {
    p_device_id: device,
    p_mutations: muts.map((m) => ({ mutation_id: m.id ?? uuid('01'), table: m.table, row: m.row })),
  });
  if (error) {
    throw new Error(`sync_push: ${error.code} ${error.message}`);
  }
  return (data as { results: PushResult[] }).results;
}

async function pull(client: SupabaseClient, since: number, limit = 500): Promise<PullResult> {
  const { data, error } = await client.rpc('sync_pull', { p_since: since, p_limit: limit });
  if (error) {
    throw new Error(`sync_pull: ${error.code} ${error.message}`);
  }
  return data as PullResult;
}

async function pullAll(client: SupabaseClient, since = 0): Promise<PullResult['rows']> {
  const rows: PullResult['rows'] = [];
  let cursor = since;
  for (;;) {
    const page = await pull(client, cursor);
    rows.push(...page.rows);
    cursor = page.next;
    if (!page.has_more) {
      return rows;
    }
  }
}

async function ensureUser(email: string): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) {
    await admin.auth.admin.deleteUser(existing.id);
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser ${email}: ${error?.message}`);
  }
  return data.user.id;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(API_URL, CLIENT_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) {
    throw new Error(`signIn ${email}: ${error.message}`);
  }
  return client;
}

beforeAll(async () => {
  expect(API_URL, 'API_URL de supabase status').not.toBe('');
  admin = createClient(API_URL, ADMIN_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  userA = await ensureUser('e2e-a@example.test');
  userB = await ensureUser('e2e-b@example.test');
  a1 = await signIn('e2e-a@example.test');
  a2 = await signIn('e2e-a@example.test');
  b1 = await signIn('e2e-b@example.test');
});

afterAll(async () => {
  await db?.query(`update app.sync_config set tombstone_retention = interval '90 days'`);
  await db?.end();
});

describe('sync ponta a ponta (Supabase local)', () => {
  const contaA = uuid('aa');

  it('US-01: o cadastro cria o perfil e o e-mail fora da allowlist é recusado', async () => {
    const { rows } = await db.query(
      'select count(*)::int as n from public.profiles where id = $1',
      [userA],
    );
    expect(rows[0]?.n).toBe(1);
    // O cadastro público passa pelo hook before_user_created (a Admin API não passa)
    const anon = createClient(API_URL, CLIENT_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signUp({
      email: 'fora-da-lista@example.test',
      password: PASSWORD,
    });
    expect(data.user).toBeNull();
    expect(error?.message ?? '').toContain('Este app é de uso privado.');
  });

  it('US-04: pai e filho no mesmo lote, duplicate e stale', async () => {
    const mutConta = uuid('01');
    const results = await push(a1, 'dev-a1', [
      { table: 'transactions', row: expense(uuid('ab'), contaA, 1990) },
      { table: 'accounts', row: account(contaA, '2026-11-05T12:00:00.000Z'), id: mutConta },
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);

    const again = await push(a1, 'dev-a1', [
      { table: 'accounts', row: account(contaA, '2026-11-05T12:00:00.000Z'), id: mutConta },
    ]);
    expect(again[0]?.status).toBe('duplicate');

    const newer = await push(a2, 'dev-a2', [
      {
        table: 'accounts',
        row: account(contaA, '2026-11-05T13:00:00.000Z', { name: 'Conta nova' }),
      },
    ]);
    expect(newer[0]?.status).toBe('applied');
    const older = await push(a1, 'dev-a1', [
      {
        table: 'accounts',
        row: account(contaA, '2026-11-05T12:30:00.000Z', { name: 'Conta velha' }),
      },
    ]);
    expect(older[0]?.status).toBe('stale');
    expect(older[0]?.row?.name).toBe('Conta nova');

    const { data: history } = await a1.rpc('get_row_history', {
      p_table: 'accounts',
      p_row_id: contaA,
    });
    expect((history as Json[]).some((h) => h.op === 'stale_write')).toBe(true);
  });

  it('US-02: B recebe rejected por FK e por linha alheia, e não vê A no pull', async () => {
    const fk = await push(b1, 'dev-b1', [
      { table: 'transactions', row: expense(uuid('bb'), contaA, 100) },
    ]);
    expect(fk[0]).toMatchObject({ status: 'rejected', code: '23503' });
    const foreign = await push(b1, 'dev-b1', [
      { table: 'accounts', row: account(contaA, '2026-12-01T00:00:00.000Z', { name: 'Invasão' }) },
    ]);
    expect(foreign[0]).toMatchObject({ status: 'rejected', code: 'FOREIGN_ROW' });
    const rows = await pullAll(b1);
    expect(rows.every((r) => r.r.user_id === userB)).toBe(true);
  });

  it('RN-96: pull pagina com has_more e o cursor não repete linhas', async () => {
    const first = await pull(a1, 0, 1);
    expect(first.rows).toHaveLength(1);
    expect(first.has_more).toBe(true);
    const rest = await pullAll(a1, first.next);
    const all = await pullAll(a1);
    expect([...first.rows, ...rest].map((r) => r.v)).toEqual(all.map((r) => r.v));
  });

  it('US-04: dois aparelhos escrevendo em paralelo e um pull concorrente sem buracos (50 iterações)', async () => {
    const before = await pullAll(a1);
    let cursor = before.at(-1)?.v ?? 0;
    const written = new Set<string>();
    const seen = new Set<string>();
    let writing = true;

    async function writer(client: SupabaseClient, device: string) {
      for (let i = 0; i < 50; i++) {
        const id = uuid(device === 'dev-a1' ? 'c1' : 'c2');
        const [res] = await push(client, device, [
          { table: 'transactions', row: expense(id, contaA, 100 + i) },
        ]);
        expect(res?.status).toBe('applied');
        written.add(id);
      }
    }

    async function reader() {
      let last = cursor;
      while (writing) {
        const page = await pull(a2, cursor, 7);
        for (const row of page.rows) {
          expect(row.v).toBeGreaterThan(last);
          last = row.v;
          seen.add(String(row.r.id));
        }
        cursor = page.next;
      }
    }

    const readerDone = reader();
    await Promise.all([writer(a1, 'dev-a1'), writer(a2, 'dev-a2')]);
    writing = false;
    await readerDone;
    for (const row of await pullAll(a2, cursor)) {
      seen.add(String(row.r.id));
    }
    expect(written.size).toBe(100);
    for (const id of written) {
      expect(seen.has(id), `linha ${id} perdida pelo cursor`).toBe(true);
    }
  });

  it('RN-99: reset_required depois do expurgo com retenção 0', async () => {
    const cursor = (await pull(a1, 0, 1)).next;
    const conta2 = uuid('ad');
    await push(a1, 'dev-a1', [
      { table: 'accounts', row: account(conta2, new Date().toISOString()) },
    ]);
    const deleted = await push(a1, 'dev-a1', [
      {
        table: 'accounts',
        row: account(conta2, new Date(Date.now() + 1000).toISOString(), {
          deleted_at: new Date(Date.now() - 60_000).toISOString(),
        }),
      },
    ]);
    expect(deleted[0]?.status).toBe('applied');
    await db.query(`update app.sync_config set tombstone_retention = interval '0'`);
    await db.query('select app.purge()');
    const { rows } = await db.query(
      'select count(*)::int as n from public.accounts where id = $1',
      [conta2],
    );
    expect(rows[0]?.n).toBe(0);
    const page = await pull(a1, cursor);
    expect(page.reset_required).toBe(true);
    const full = await pull(a1, 0);
    expect(full.reset_required).toBeUndefined();
  });
});
