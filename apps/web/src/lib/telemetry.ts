// Telemetria mínima (tech §7.3, RN-104): só códigos da allowlist e `context` com chaves da allowlist — nunca
// valores, descrições, CNPJ, e-mail ou tokens. Fila local no `kv`, enviada por `log_events` a cada sync, em lotes
// de 50. Os eventos de uso da RN-104 vão como `usage.<nome>` (retenção de 180 dias no `app.purge`); os técnicos
// (`sync.*`, `import.*`, `nfce.*`, `error.*`) ficam 30 dias. Os últimos 20 também ficam no aparelho (S11).
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
  // RN-104: sync_falha {codigo}, importacao_concluida {fonte, novas, conciliadas, pendentes}, push_recebido {tipo}
  'codigo',
  'fonte',
  'novas',
  'conciliadas',
  'pendentes',
  'tipo',
] as const;

/** Eventos de uso da RN-104 (sem valores monetários nem descrições). */
export const USAGE_EVENTS = [
  'app_aberto',
  'lancamento_iniciado',
  'lancamento_salvo',
  'sync_ok',
  'sync_falha',
  'importacao_concluida',
  'mes_fechado',
  'push_recebido',
  'regra_corrigida',
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

/** Códigos aceitos: os de uso (`usage.*`), os marcos técnicos da tech §7.3 e os erros não tratados. */
export const EVENT_CODES: readonly string[] = [
  ...USAGE_EVENTS.map((name) => `usage.${name}`),
  'sync.done',
  'sync.failed',
  'sync.rejected',
  'import.committed',
  'nfce.fallback',
  'error.uncaught',
  'error.unhandled',
];

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
/** Os últimos eventos deste aparelho, para o Diagnóstico (S11). */
export const TELEMETRY_RECENT_KEY = 'telemetry_recent';
export const TELEMETRY_RECENT = 20;
export const TELEMETRY_BATCH = 50;
/** Teto da fila local: os mais antigos saem primeiro. */
export const TELEMETRY_MAX = 500;

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

async function readQueue(db: OakDb, key: string = TELEMETRY_KEY): Promise<TelemetryEvent[]> {
  const entry = await db.kv.get(key);
  return Array.isArray(entry?.value) ? (entry.value as TelemetryEvent[]) : [];
}

/** Os últimos eventos registrados neste aparelho, do mais novo para o mais antigo (S11). */
export async function recentEvents(db: OakDb): Promise<TelemetryEvent[]> {
  return (await readQueue(db, TELEMETRY_RECENT_KEY)).slice().reverse();
}

/** Enfileira um evento. Código fora da allowlist (`EVENT_CODES`) é recusado (devolve `false`). Nunca lança. */
export async function track(db: OakDb, input: TrackInput): Promise<boolean> {
  if (!EVENT_CODES.includes(input.code)) {
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
      const recent = await readQueue(db, TELEMETRY_RECENT_KEY);
      recent.push(event);
      await db.kv.put({ key: TELEMETRY_RECENT_KEY, value: recent.slice(-TELEMETRY_RECENT) });
    });
    return true;
  } catch {
    return false;
  }
}

/** Evento de uso da RN-104 (`usage.<nome>`). */
export function trackUsage(
  db: OakDb,
  name: UsageEvent,
  context: Readonly<Record<string, unknown>> = {},
  options: Pick<TrackInput, 'nowMs' | 'appVersion' | 'deviceId'> = {},
): Promise<boolean> {
  return track(db, { code: `usage.${name}`, context, ...options });
}

/** Nome curto do erro (ex.: `TypeError`), nunca a mensagem, que pode ter dados do usuário. */
function errorName(value: unknown): string {
  if (value instanceof Error) {
    return value.name;
  }
  return value === null ? 'null' : typeof value;
}

interface ErrorTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/**
 * `window.onerror` e `unhandledrejection` (tech §7.3): viram `error.uncaught` e `error.unhandled` com só o nome
 * do erro em `reason`. Devolve a função que remove os ouvintes.
 */
export function captureErrors(
  db: OakDb,
  target: ErrorTarget = window,
  appVersion?: string,
): () => void {
  const extra = appVersion !== undefined ? { appVersion } : {};
  const onError = (event: Event) => {
    const error = (event as ErrorEvent).error;
    void track(db, {
      level: 'error',
      code: 'error.uncaught',
      context: { reason: errorName(error ?? new Error()) },
      ...extra,
    });
  };
  const onRejection = (event: Event) => {
    void track(db, {
      level: 'error',
      code: 'error.unhandled',
      context: { reason: errorName((event as PromiseRejectionEvent).reason) },
      ...extra,
    });
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
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
