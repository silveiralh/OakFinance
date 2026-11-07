// Edge Function `account-delete` (tech §6.0 [CONTRATO], US-61): auth do usuário; a chave secreta só remove o
// próprio usuário que chamou (identificado pelo JWT).
import { createClient } from '@supabase/supabase-js';
import { handleAccountDelete } from '../_shared/account-delete.ts';
import { secretKeysFromEnv } from '../_shared/auth.ts';
import { PluggyConnector, pluggyConfigFromEnv } from '../_shared/connectors/pluggy/client.ts';
import { readCorsConfig } from '../_shared/http.ts';
import { userCaller } from '../_shared/pluggy-supabase.ts';

const env = { get: (name: string) => Deno.env.get(name) };

function admin() {
  const key = secretKeysFromEnv(env)[0];
  if (!key) {
    throw new Error('sem chave secreta');
  }
  return createClient(env.get('SUPABASE_URL') ?? '', key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve((request) =>
  handleAccountDelete(request, {
    cors: readCorsConfig(env),
    caller: userCaller,
    connector: () => new PluggyConnector(pluggyConfigFromEnv(env)),
    store: {
      async connections(userId) {
        const { data, error } = await admin()
          .from('bank_connections')
          .select('id, external_item_id, deleted_at')
          .eq('user_id', userId);
        if (error) {
          throw new Error(`bank_connections: ${error.code ?? 'erro'}`);
        }
        return data ?? [];
      },
      async deleteUser(userId) {
        const { error } = await admin().auth.admin.deleteUser(userId);
        if (error) {
          throw new Error(`auth.admin.deleteUser: ${error.status ?? 'erro'}`);
        }
      },
    },
  }),
);
