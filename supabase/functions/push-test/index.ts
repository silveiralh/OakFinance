// Edge Function `push-test` (tech §6.0): auth do usuário pelo token; lê e atualiza as próprias inscrições com RLS.
import { createClient } from '@supabase/supabase-js';
import { readCorsConfig } from '../_shared/http.ts';
import { vapidFromEnv, webPushSender } from '../_shared/push.ts';
import { handlePushTest } from './handler.ts';

const env = { get: (name: string) => Deno.env.get(name) };

function userClient(authorization: string) {
  return createClient(env.get('SUPABASE_URL') ?? '', env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve((request) =>
  handlePushTest(request, {
    cors: readCorsConfig(env),
    appOrigin: env.get('APP_ORIGIN') ?? 'http://localhost:5173',
    vapid: vapidFromEnv(env),
    sender: (vapid) => webPushSender(vapid),
    async subscriptions(authorization) {
      const client = userClient(authorization);
      const { data: user, error } = await client.auth.getUser(authorization.slice(7));
      if (error || !user.user) {
        return null;
      }
      const { data } = await client
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .is('disabled_at', null);
      return data ?? [];
    },
    async record(authorization, results) {
      const client = userClient(authorization);
      const now = new Date().toISOString();
      for (const r of results) {
        const change =
          r.outcome === 'sent'
            ? { last_success_at: now, failure_count: 0 }
            : r.outcome === 'gone'
              ? { disabled_at: now, last_failure_at: now }
              : { last_failure_at: now };
        await client.from('push_subscriptions').update(change).eq('id', r.id);
      }
    },
  }),
);
