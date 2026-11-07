// Edge Function `reminders-tick` (tech §6.0): auth 'secret' (pg_cron com a chave secreta no header `apikey`).
// O cliente usa a própria chave secreta validada; todo acesso é pelas RPCs da migração 09 (só service_role).
import { createClient } from '@supabase/supabase-js';
import { authorizedSecret, secretKeysFromEnv } from '../_shared/auth.ts';
import { vapidFromEnv, webPushSender } from '../_shared/push.ts';
import { handleRemindersTick, type TickStore } from './handler.ts';
import type { ClaimedEntry, SendContext, UserSnapshot } from './tick.ts';

const env = { get: (name: string) => Deno.env.get(name) };

function storeWith(secretKey: string): TickStore {
  const client = createClient(env.get('SUPABASE_URL') ?? '', secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      throw new Error(`rpc ${fn}: ${error.code ?? 'erro'}`);
    }
    return data as T;
  }
  return {
    start: () => call<number>('reminders_tick_start', {}),
    finish: (run, status, stats, error) =>
      call<null>('reminders_tick_finish', {
        p_run: run,
        p_status: status,
        p_stats: stats,
        p_error: error ?? null,
      }).then(() => undefined),
    snapshot: (now) =>
      call<UserSnapshot[]>('reminders_tick_snapshot', { p_now: now.toISOString() }),
    save: (userId, notices, outbox) =>
      call<number>('reminders_tick_save', { p_user: userId, p_notices: notices, p_outbox: outbox }),
    claim: (now, limit) =>
      call<ClaimedEntry[]>('reminders_tick_claim', { p_now: now.toISOString(), p_limit: limit }),
    context: (userId, now) =>
      call<SendContext>('reminders_tick_context', { p_user: userId, p_now: now.toISOString() }),
    record: (now, outbox, subscriptions) =>
      call<null>('reminders_tick_record', {
        p_now: now.toISOString(),
        p_outbox: outbox,
        p_subs: subscriptions,
      }).then(() => undefined),
  };
}

Deno.serve((request) =>
  handleRemindersTick(request, {
    storeFor(req) {
      const key = authorizedSecret(req, secretKeysFromEnv(env));
      return key ? storeWith(key) : null;
    },
    now: () => new Date(),
    appOrigin: env.get('APP_ORIGIN') ?? 'http://localhost:5173',
    vapid: vapidFromEnv(env),
    sender: (vapid) => webPushSender(vapid),
  }),
);
