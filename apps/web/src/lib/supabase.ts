// Cliente do Supabase (tech §4.9): PKCE, sessão persistida e renovação automática. Sem a chave publicável
// (build local sem Supabase), não há cliente e o app fica na tela de entrada.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { type AppEnv, getEnv } from './env';

let client: SupabaseClient | null | undefined;

export function createSupabase(env: AppEnv): SupabaseClient | null {
  if (!env.supabasePublishableKey) {
    return null;
  }
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      // o /auth/callback troca o código explicitamente (e trata o erro do hook de cadastro)
      detectSessionInUrl: false,
    },
  });
}

/** Cliente único do app. */
export function getSupabase(): SupabaseClient | null {
  if (client === undefined) {
    client = createSupabase(getEnv());
  }
  return client;
}
