// Ligação das funções `pluggy-*` com o Supabase (tech §6.0): o token do usuário identifica quem chama e conta o
// rate limit; a chave secreta grava `bank_connections`/`external_accounts` (o app só lê), sempre com `user_id`.
import { createClient } from '@supabase/supabase-js';
import { secretKeysFromEnv } from './auth.ts';
import { PluggyConnector, pluggyConfigFromEnv } from './connectors/pluggy/client.ts';
import { readCorsConfig } from './http.ts';
import type { ExternalAccountRef, LinkStore, PluggyDeps } from './pluggy-link.ts';

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

/** Dependências reais das funções `pluggy-connect-token` e `pluggy-link-item`. */
export function pluggyDeps(): PluggyDeps {
  return {
    cors: readCorsConfig(env),
    async caller(authorization) {
      const client = createClient(
        env.get('SUPABASE_URL') ?? '',
        env.get('SUPABASE_ANON_KEY') ?? '',
        {
          ...options,
          global: { headers: { Authorization: authorization } },
        },
      );
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
    },
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
