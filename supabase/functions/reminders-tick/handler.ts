// reminders-tick (tech §6.0 e §6.4.5, US-39, US-40): chamado pelo pg_cron a cada 15 min com a chave secreta.
// 1) para cada usuário, grava os avisos devidos na central e enfileira o push (com inscrição e VAPID);
// 2) envia os push devidos da fila e registra o resultado; 3) grava a execução em app.job_runs.
// Saída [CONTRATO]: `{ enqueued, sent, failed }`.
import { AppError } from '../_shared/errors.ts';
import { handleError, jsonResponse } from '../_shared/http.ts';
import { type PushSender, type SendResult, sendAll, type VapidConfig } from '../_shared/push.ts';
import {
  type ClaimedEntry,
  entryOutcome,
  type NoticeRow,
  type OutboxRow,
  planUser,
  type SendContext,
  sendDecision,
  type UserSnapshot,
  urgencyOf,
} from './tick.ts';

export interface OutboxResult {
  id: string;
  status: 'sent' | 'failed' | 'skipped' | 'pending';
  error?: string;
}

export interface SubscriptionResult {
  id: string;
  outcome: SendResult['outcome'];
}

export type RunStatus = 'ok' | 'partial' | 'error';

/** Acesso ao banco (RPCs da migração 09), sempre com a chave secreta. */
export interface TickStore {
  start(): Promise<number>;
  finish(run: number, status: RunStatus, stats: TickStats, error?: string): Promise<void>;
  snapshot(now: Date): Promise<UserSnapshot[]>;
  save(userId: string, notices: NoticeRow[], outbox: OutboxRow[]): Promise<number>;
  claim(now: Date, limit: number): Promise<ClaimedEntry[]>;
  context(userId: string, now: Date): Promise<SendContext>;
  record(now: Date, outbox: OutboxResult[], subscriptions: SubscriptionResult[]): Promise<void>;
}

export interface TickDeps {
  /** Store da requisição autorizada pela chave secreta; `null` quando a chave não vale. */
  storeFor(request: Request): TickStore | null;
  now(): Date;
  appOrigin: string;
  vapid: VapidConfig | null;
  sender(vapid: VapidConfig): PushSender;
  claimLimit?: number;
}

export interface TickStats {
  users: number;
  userErrors: number;
  notices: number;
  enqueued: number;
  sent: number;
  failed: number;
  skipped: number;
  retried: number;
  push: boolean;
}

const NO_CORS = {};

function emptyStats(push: boolean): TickStats {
  return {
    users: 0,
    userErrors: 0,
    notices: 0,
    enqueued: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    retried: 0,
    push,
  };
}

/** Fase 1: avisos e fila de cada usuário. Um usuário com erro não impede os outros (status `partial`). */
async function planAll(
  store: TickStore,
  deps: TickDeps,
  now: Date,
  stats: TickStats,
): Promise<void> {
  const users = await store.snapshot(now);
  stats.users = users.length;
  for (const snap of users) {
    try {
      const plan = planUser(snap, now, {
        pushEnabled: deps.vapid !== null,
        appOrigin: deps.appOrigin,
      });
      if (plan.notices.length === 0 && plan.outbox.length === 0) {
        continue;
      }
      stats.enqueued += await store.save(snap.userId, plan.notices, plan.outbox);
      stats.notices += plan.notices.length;
    } catch {
      stats.userErrors += 1;
    }
  }
}

/** Fase 2: envia os push devidos, agrupados por usuário (o teto de 3 por dia conta os enviados neste tick). */
async function sendDue(
  store: TickStore,
  vapid: VapidConfig,
  deps: TickDeps,
  now: Date,
  stats: TickStats,
): Promise<void> {
  const claimed = await store.claim(now, deps.claimLimit ?? 100);
  const byUser = new Map<string, ClaimedEntry[]>();
  for (const entry of claimed) {
    byUser.set(entry.userId, [...(byUser.get(entry.userId) ?? []), entry]);
  }
  const sender = deps.sender(vapid);
  for (const [userId, entries] of byUser) {
    try {
      const ctx = await store.context(userId, now);
      for (const entry of entries) {
        const decision = sendDecision(entry, ctx);
        if (decision.action === 'skip') {
          stats.skipped += 1;
          await store.record(
            now,
            [{ id: entry.id, status: 'skipped', error: decision.reason }],
            [],
          );
          continue;
        }
        const results = await sendAll(ctx.subscriptions, JSON.stringify(entry.payload), sender, {
          topic: entry.kind,
          urgency: urgencyOf(entry),
        });
        const outcome = entryOutcome(results, entry.attempts);
        if (outcome.status === 'sent') {
          stats.sent += 1;
          ctx.sentToday += 1;
        } else if (outcome.status === 'failed') {
          stats.failed += 1;
        } else {
          stats.retried += 1;
        }
        const gone = new Set(results.filter((r) => r.outcome === 'gone').map((r) => r.id));
        ctx.subscriptions = ctx.subscriptions.filter((s) => !gone.has(s.id));
        await store.record(
          now,
          [
            {
              id: entry.id,
              status: outcome.status,
              ...(outcome.error ? { error: outcome.error } : {}),
            },
          ],
          results.map((r) => ({ id: r.id, outcome: r.outcome })),
        );
      }
    } catch {
      stats.userErrors += 1;
    }
  }
}

export async function handleRemindersTick(request: Request, deps: TickDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    const store = deps.storeFor(request);
    if (!store) {
      throw new AppError('UNAUTHORIZED');
    }
    const now = deps.now();
    const stats = emptyStats(deps.vapid !== null);
    const run = await store.start();
    try {
      await planAll(store, deps, now, stats);
      if (deps.vapid) {
        await sendDue(store, deps.vapid, deps, now, stats);
      }
    } catch (error) {
      await store.finish(run, 'error', stats, error instanceof Error ? error.name : 'Error');
      throw new AppError('INTERNAL');
    }
    await store.finish(run, stats.userErrors > 0 ? 'partial' : 'ok', stats);
    return jsonResponse(
      { enqueued: stats.enqueued, sent: stats.sent, failed: stats.failed },
      request,
      NO_CORS,
    );
  } catch (error) {
    return handleError(error, request, NO_CORS);
  }
}
