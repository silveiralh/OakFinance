// Ligação das funções `pluggy-*` com o Supabase (tech §6.0): o token do usuário identifica quem chama e conta o
// rate limit; a chave secreta grava `bank_connections`/`external_accounts` (o app só lê), sempre com `user_id`.
import { createClient } from '@supabase/supabase-js';
import { authorizedSecret, secretKeysFromEnv } from './auth.ts';
import { PluggyConnector, pluggyConfigFromEnv } from './connectors/pluggy/client.ts';
import type { Card, Category, CategoryRule, ISODate } from './domain/index.ts';
import { todayIn } from './domain/index.ts';
import { readCorsConfig } from './http.ts';
import type { InvoiceRef } from './ingest.ts';
import type { Caller } from './pluggy-functions.ts';
import type { ExternalAccountRef, LinkStore, PluggyDeps } from './pluggy-link.ts';
import type {
  ConnectionRow,
  ExistingTx,
  ExternalAccountRow,
  SyncHandlerDeps,
  SyncStore,
} from './pluggy-sync.ts';

const env = { get: (name: string) => Deno.env.get(name) };
const options = { auth: { persistSession: false, autoRefreshToken: false } };

function adminClient() {
  const key = secretKeysFromEnv(env)[0];
  if (!key) {
    throw new Error('sem chave secreta');
  }
  return createClient(env.get('SUPABASE_URL') ?? '', key, options);
}

function fail(what: string, error: { code?: string } | null): never {
  throw new Error(`${what}: ${error?.code ?? 'erro'}`);
}

function store(): LinkStore {
  const admin = adminClient();
  return {
    async connectionByItem(itemId) {
      const { data, error } = await admin
        .from('bank_connections')
        .select('id, user_id')
        .eq('external_item_id', itemId)
        .maybeSingle();
      if (error) {
        fail('bank_connections', error);
      }
      return data;
    },
    async saveConnection(row) {
      const { error } = await admin.from('bank_connections').upsert(row, { onConflict: 'id' });
      if (error) {
        fail('bank_connections', error);
      }
    },
    async externalAccounts(externalIds) {
      if (externalIds.length === 0) {
        return [];
      }
      const { data, error } = await admin
        .from('external_accounts')
        .select('id, user_id, external_account_id, account_id, card_id, is_ignored')
        .in('external_account_id', [...externalIds]);
      if (error) {
        fail('external_accounts', error);
      }
      return (data ?? []) as ExternalAccountRef[];
    },
    async saveExternalAccounts(rows) {
      if (rows.length === 0) {
        return;
      }
      const { error } = await admin
        .from('external_accounts')
        .upsert([...rows], { onConflict: 'id' });
      if (error) {
        fail('external_accounts', error);
      }
    },
  };
}

async function userCaller(authorization: string): Promise<Caller | null> {
  const client = createClient(env.get('SUPABASE_URL') ?? '', env.get('SUPABASE_ANON_KEY') ?? '', {
    ...options,
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user) {
    return null;
  }
  return {
    userId: data.user.id,
    async hit(bucket, limit, windowSeconds) {
      const { data: ok, error: rpcError } = await client.rpc('rate_limit_hit', {
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (rpcError) {
        fail('rate_limit_hit', rpcError);
      }
      return ok === true;
    },
  };
}

/** Dependências reais das funções `pluggy-connect-token` e `pluggy-link-item`. */
export function pluggyDeps(): PluggyDeps {
  return {
    cors: readCorsConfig(env),
    caller: userCaller,
    connector: () => new PluggyConnector(pluggyConfigFromEnv(env)),
    allowedConnectorIds: (env.get('PLUGGY_ALLOWED_CONNECTOR_IDS') ?? '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0),
    get store() {
      return store();
    },
    newId: () => crypto.randomUUID(),
    now: () => new Date(),
  };
}

type Row = Record<string, unknown>;

function syncStore(): SyncStore {
  const admin = adminClient();
  const check = (what: string, error: { code?: string } | null) => {
    if (error) {
      fail(what, error);
    }
  };
  const update = async (table: string, id: string, userId: string, patch: Row) => {
    const { error } = await admin.from(table).update(patch).eq('id', id).eq('user_id', userId);
    check(table, error);
  };
  return {
    async connection(id) {
      const { data, error } = await admin
        .from('bank_connections')
        .select('id, user_id, external_item_id, is_active, deleted_at, last_manual_refresh_at')
        .eq('id', id)
        .maybeSingle();
      check('bank_connections', error);
      return data as ConnectionRow | null;
    },
    updateConnection: (id, userId, patch) => update('bank_connections', id, userId, patch),
    async startRun(userId, connectionId) {
      const { data, error } = await admin.rpc('pluggy_sync_start', {
        p_user: userId,
        p_connection: connectionId,
      });
      check('pluggy_sync_start', error);
      return Number(data);
    },
    async finishRun(run, status, stats, error) {
      const { error: rpcError } = await admin.rpc('pluggy_sync_finish', {
        p_run: run,
        p_status: status,
        p_stats: stats,
        p_error: error ?? null,
      });
      check('pluggy_sync_finish', rpcError);
    },
    async externalAccounts(connectionId, userId) {
      const { data, error } = await admin
        .from('external_accounts')
        .select(
          'id, user_id, external_account_id, account_id, card_id, is_ignored, last_tx_date, deleted_at',
        )
        .eq('connection_id', connectionId)
        .eq('user_id', userId);
      check('external_accounts', error);
      return (data ?? []) as ExternalAccountRow[];
    },
    updateExternalAccount: (id, userId, patch) => update('external_accounts', id, userId, patch),
    async card(id, userId) {
      const { data, error } = await admin
        .from('cards')
        .select('id, closing_day, due_day, closing_day_rule, limit_cents, payment_account_id')
        .eq('id', id)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .maybeSingle();
      check('cards', error);
      if (!data) {
        return null;
      }
      const c = data as Row;
      return {
        id: String(c.id),
        closingDay: Number(c.closing_day),
        dueDay: Number(c.due_day),
        closingDayRule: c.closing_day_rule === 'same' ? 'same' : 'next',
        limitCents: c.limit_cents === null ? null : Number(c.limit_cents),
        paymentAccountId: (c.payment_account_id as string | null) ?? null,
      } satisfies Card;
    },
    async invoices(cardId, userId) {
      const { data, error } = await admin
        .from('invoices')
        .select(
          'id, card_id, reference_month, closing_date, due_date, external_bill_id, deleted_at',
        )
        .eq('card_id', cardId)
        .eq('user_id', userId);
      check('invoices', error);
      return (data ?? []) as InvoiceRef[];
    },
    async insertInvoice(row) {
      const { error } = await admin
        .from('invoices')
        .upsert(row, { onConflict: 'id', ignoreDuplicates: true });
      check('invoices', error);
    },
    updateInvoice: (id, userId, patch) => update('invoices', id, userId, patch),
    async categories(userId) {
      const { data, error } = await admin
        .from('categories')
        .select('id, parent_id, kind, bucket, slug, feeds_reserve, is_system')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .is('archived_at', null);
      check('categories', error);
      return ((data ?? []) as Row[]).map(
        (c) =>
          ({
            id: String(c.id),
            parentId: (c.parent_id as string | null) ?? null,
            kind: c.kind,
            bucket: c.bucket,
            slug: (c.slug as string | null) ?? null,
            feedsReserve: Boolean(c.feeds_reserve),
            isSystem: Boolean(c.is_system),
          }) as Category,
      );
    },
    async rules(userId) {
      const { data, error } = await admin
        .from('category_rules')
        .select(
          'id, match_field, match_type, pattern, category_id, account_id, card_id, payment_method, source, priority, hits, last_hit_at, enabled',
        )
        .eq('user_id', userId)
        .is('deleted_at', null);
      check('category_rules', error);
      return ((data ?? []) as Row[]).map(
        (r) =>
          ({
            id: String(r.id),
            matchField: r.match_field,
            matchType: r.match_type,
            pattern: String(r.pattern),
            categoryId: String(r.category_id),
            accountId: (r.account_id as string | null) ?? null,
            cardId: (r.card_id as string | null) ?? null,
            paymentMethod: (r.payment_method as string | null) ?? null,
            source: r.source,
            priority: Number(r.priority),
            hits: Number(r.hits),
            lastHitAt: (r.last_hit_at as string | null) ?? null,
            enabled: Boolean(r.enabled),
          }) as CategoryRule,
      );
    },
    async startedOn(userId) {
      const { data, error } = await admin
        .from('profiles')
        .select('onboarding, created_at')
        .eq('user_id', userId)
        .maybeSingle();
      check('profiles', error);
      const profile = data as Row | null;
      const started = (profile?.onboarding as Row | null)?.startedAt ?? profile?.created_at;
      const date = typeof started === 'string' ? new Date(started) : null;
      return date && !Number.isNaN(date.getTime())
        ? (todayIn('America/Sao_Paulo', date) as ISODate)
        : null;
    },
    async existingTransactions(userId, externalIds) {
      const { data, error } = await admin
        .from('transactions')
        .select(
          'id, external_id, amount_cents, occurred_on, occurred_at, status, description_raw, external_meta, invoice_id, invoice_pinned',
        )
        .eq('user_id', userId)
        .eq('source', 'pluggy')
        .in('external_id', [...externalIds]);
      check('transactions', error);
      return (data ?? []) as ExistingTx[];
    },
    async insertTransactions(rows) {
      const { error } = await admin
        .from('transactions')
        .upsert([...rows], { onConflict: 'id', ignoreDuplicates: true });
      check('transactions', error);
    },
    updateTransaction: (id, userId, patch) => update('transactions', id, userId, patch),
  };
}

/** Dependências reais da função `pluggy-sync`. */
export function syncDeps(): SyncHandlerDeps {
  return {
    cors: readCorsConfig(env),
    isSecret: (request) => authorizedSecret(request, secretKeysFromEnv(env)) !== null,
    caller: userCaller,
    connector: () => new PluggyConnector(pluggyConfigFromEnv(env)),
    get store() {
      return syncStore();
    },
    now: () => new Date(),
  };
}
