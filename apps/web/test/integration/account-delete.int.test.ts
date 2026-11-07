// Excluir conta contra o Supabase local (T-094; US-61, RN-102): a `account-delete` remove o usuário de
// `auth.users` (o mesmo `auth.admin.deleteUser` daqui) e o banco apaga em cascata tudo o que é dele; o outro
// usuário não é afetado. Usuários criados pela Admin API (e-mails @example.test).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API_URL = process.env.API_URL ?? '';
const ADMIN_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY ?? '';
const DB_URL = process.env.DB_URL ?? '';

let admin: SupabaseClient;
let db: pg.Client;

async function freshUser(email: string): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) {
    await admin.auth.admin.deleteUser(existing.id);
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: 'senha-local-de-teste-123',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createUser ${email}: ${error?.message}`);
  }
  return data.user.id;
}

/** Dados de um usuário em várias tabelas (conta, lançamento, aviso, inscrição de push, conexão bancária). */
async function seed(userId: string, tag: string) {
  const id = (n: number) => `${tag}000000-0000-4000-8000-00000000000${n}`;
  await db.query(
    `insert into public.accounts (id, user_id, name, type) values ($1, $2, 'Conta', 'checking')`,
    [id(1), userId],
  );
  await db.query(
    `insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id)
     values ($1, $2, 'expense', 1000, '2026-11-05', 'pix', $3)`,
    [id(2), userId, id(1)],
  );
  await db.query(
    `insert into public.notices (id, user_id, kind, dedupe_key, title, body, navigate)
     values ($1, $2, 'daily_log', 'daily_log:2026-11-05', 'Registrar gastos de hoje', 'x', '/')`,
    [id(3), userId],
  );
  await db.query(
    `insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, platform)
     values ($1, $2, $3, 'p', 'a', 'android')`,
    [id(4), userId, `https://push.example.test/${tag}`],
  );
  await db.query(
    `insert into public.bank_connections (id, user_id, provider, external_item_id, connector_name, status)
     values ($1, $2, 'pluggy', $3, 'Banco', 'UPDATED')`,
    [id(5), userId, `item-${tag}`],
  );
}

/** Linhas do usuário em todas as tabelas públicas com `user_id`. */
async function rowsOf(userId: string): Promise<Record<string, number>> {
  const { rows: tables } = await db.query<{ table_name: string }>(
    `select c.table_name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
      order by 1`,
  );
  const out: Record<string, number> = {};
  for (const { table_name } of tables) {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.${table_name} where user_id = $1`,
      [userId],
    );
    out[table_name] = rows[0]?.n ?? 0;
  }
  return out;
}

const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

beforeAll(async () => {
  expect(API_URL, 'API_URL de supabase status').not.toBe('');
  admin = createClient(API_URL, ADMIN_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
});

describe('excluir conta (Supabase local)', () => {
  it('US-61: apagar o usuário A remove tudo dele em cascata e não toca em nada do B', async () => {
    const userA = await freshUser('e2e-del-a@example.test');
    const userB = await freshUser('e2e-del-b@example.test');
    await seed(userA, 'da');
    await seed(userB, 'db');
    const beforeB = await rowsOf(userB);
    expect(total(await rowsOf(userA))).toBeGreaterThanOrEqual(6); // perfil + as 5 tabelas acima

    const { error } = await admin.auth.admin.deleteUser(userA);
    expect(error).toBeNull();

    expect(total(await rowsOf(userA))).toBe(0);
    const { rows } = await db.query('select count(*)::int as n from auth.users where id = $1', [
      userA,
    ]);
    expect(rows[0]?.n).toBe(0);
    expect(await rowsOf(userB)).toEqual(beforeB);
    expect(beforeB.transactions).toBe(1);
    expect(beforeB.bank_connections).toBe(1);
  });
});
