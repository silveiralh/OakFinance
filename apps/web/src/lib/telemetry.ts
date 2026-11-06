// Telemetria mínima (tech §7.3, RN-104): só `code` e `context` com chaves da allowlist — nunca valores,
// descrições, CNPJ, e-mail ou tokens. Fila local no `kv`, enviada por `log_events` a cada sync, em lotes de 50.
import type { OakDb } from '../data/db';
import { callRpc, type SyncTransport } from '../data/sync/transport';

export type TelemetryLevel = 'info' | 'warn' | 'error';

/** Chaves aceitas em `context`; o resto é descartado. Valores só número, booleano ou texto curto sem espaço. */
export const CONTEXT_KEYS = [
  'table',
  'status',
  'reason',
  'count',
  'attempts',
  'batches',
  'applied',
  'stale',
  'rejected',
  'pages',
  'rows',
  'duration_ms',
  // RN-104: lancamento_salvo {duracao_ms, offline, origem}
  'duracao_ms',
  'offline',
  'origem',
] as const;

export type ContextKey = (typeof CONTEXT_KEYS)[number];
export type TelemetryContext = Partial<Record<ContextKey, string | number | boolean>>;

export interface TelemetryEvent {
  at: string;
  level: TelemetryLevel;
  code: string;
  context: TelemetryContext;
  app_version?: string;
  device_id?: string;
}

export const TELEMETRY_KEY = 'telemetry_queue';
export const TELEMETRY_BATCH = 50;
/** Teto da fila local: os mais antigos saem primeiro. */
export const TELEMETRY_MAX = 500;

const CODE_RE = /^[a-z][a-z0-9_.]{1,63}$/;
const TEXT_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Limpa o contexto: só chaves da allowlist e valores sem texto livre. */
export function sanitizeContext(context: Readonly<Record<string, unknown>>): TelemetryContext {
  const out: TelemetryContext = {};
  for (const key of CONTEXT_KEYS) {
    const value = context[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (typeof value === 'string' && TEXT_RE.test(value)) {
      out[key] = value;
    }
  }
  return out;
}

export interface TrackInput {
  level?: TelemetryLevel;
  code: string;
  context?: Readonly<Record<string, unknown>>;
  nowMs?: number;
  appVersion?: string;
  deviceId?: string;
}

async function readQueue(db: OakDb): Promise<TelemetryEvent[]> {
  const entry = await db.kv.get(TELEMETRY_KEY);
  return Array.isArray(entry?.value) ? (entry.value as TelemetryEvent[]) : [];
}

/** Enfileira um evento. Código fora do padrão `a.b_c` é recusado (devolve `false`). Nunca lança. */
export async function track(db: OakDb, input: TrackInput): Promise<boolean> {
  if (!CODE_RE.test(input.code)) {
    return false;
  }
  const event: TelemetryEvent = {
    at: new Date(input.nowMs ?? Date.now()).toISOString(),
    level: input.level ?? 'info',
    code: input.code,
    context: sanitizeContext(input.context ?? {}),
    ...(input.appVersion !== undefined && { app_version: input.appVersion }),
    ...(input.deviceId !== undefined && { device_id: input.deviceId }),
  };
  try {
    await db.transaction('rw', db.kv, async () => {
      const queue = await readQueue(db);
      queue.push(event);
      await db.kv.put({ key: TELEMETRY_KEY, value: queue.slice(-TELEMETRY_MAX) });
    });
    return true;
  } catch {
    return false;
  }
}

/** Envia a fila em lotes de 50; para no primeiro erro (fica para o próximo sync). Devolve quantos foram. */
export async function flushTelemetry(db: OakDb, transport: SyncTransport): Promise<number> {
  let sent = 0;
  for (;;) {
    const queue = await readQueue(db);
    const batch = queue.slice(0, TELEMETRY_BATCH);
    if (batch.length === 0) {
      return sent;
    }
    try {
      await callRpc(transport, 'log_events', { p_events: batch });
    } catch {
      return sent;
    }
    await db.transaction('rw', db.kv, async () => {
      const current = await readQueue(db);
      await db.kv.put({ key: TELEMETRY_KEY, value: current.slice(batch.length) });
    });
    sent += batch.length;
  }
}
