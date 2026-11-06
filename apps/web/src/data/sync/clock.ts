// Relógio híbrido simples (tech §4.3): `hlcNow() = max(Date.now() + serverOffsetMs, hlcLast + 1)`, em ISO com
// milissegundos. Toda escrita local usa esse valor em `client_updated_at` (RN-97: a última edição vence).
import type { OakDb } from '../db';
import { newId } from '../ids';

/** Amostras com ida e volta acima disso são descartadas (tech §4.3). */
export const MAX_RTT_MS = 2000;
/** Peso da amostra nova na média móvel do deslocamento. */
export const OFFSET_SMOOTHING = 0.3;

export interface ClockState {
  serverOffsetMs: number;
  hlcLastMs: number;
}

/** Próximo instante do relógio: nunca volta e nunca repete. */
export function nextHlc(nowMs: number, state: ClockState): number {
  return Math.max(Math.round(nowMs + state.serverOffsetMs), state.hlcLastMs + 1);
}

export function hlcIso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface OffsetSample {
  /** `server_time` devolvido pelo `sync_pull` (ISO). */
  serverTime: string;
  sentAtMs: number;
  receivedAtMs: number;
}

/**
 * Atualiza o deslocamento estimado entre o relógio do aparelho e o do servidor. A amostra assume o meio da ida e
 * volta; RTT > 2 s ou hora inválida é ignorada (devolve o anterior).
 */
export function updateServerOffset(previous: number | null, sample: OffsetSample): number | null {
  const rtt = sample.receivedAtMs - sample.sentAtMs;
  const server = Date.parse(sample.serverTime);
  if (rtt < 0 || rtt > MAX_RTT_MS || Number.isNaN(server)) {
    return previous;
  }
  const offset = server - (sample.sentAtMs + rtt / 2);
  return previous === null
    ? Math.round(offset)
    : Math.round(previous + OFFSET_SMOOTHING * (offset - previous));
}

async function numberState(db: OakDb, key: 'server_offset_ms' | 'hlc_last'): Promise<number> {
  const entry = await db.sync_state.get(key);
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/**
 * `client_updated_at` da próxima escrita, gravando `hlc_last`. Chame dentro da transação da escrita (com
 * `sync_state` no escopo) para o relógio andar junto com a linha.
 */
export async function hlcNow(db: OakDb, nowMs: number = Date.now()): Promise<string> {
  const state = {
    serverOffsetMs: await numberState(db, 'server_offset_ms'),
    hlcLastMs: await numberState(db, 'hlc_last'),
  };
  const next = nextHlc(nowMs, state);
  await db.sync_state.put({ key: 'hlc_last', value: next });
  return hlcIso(next);
}

/** Registra uma amostra de `server_time` (chamado pelo pull, T-033). */
export async function recordServerTime(db: OakDb, sample: OffsetSample): Promise<number | null> {
  const entry = await db.sync_state.get('server_offset_ms');
  const previous = typeof entry?.value === 'number' ? entry.value : null;
  const next = updateServerOffset(previous, sample);
  if (next !== null && next !== previous) {
    await db.sync_state.put({ key: 'server_offset_ms', value: next });
  }
  return next;
}

/** `device_id` do aparelho: UUID v7 criado na primeira execução e guardado em `sync_state`. */
export async function deviceId(db: OakDb, create: () => string = newId): Promise<string> {
  return db.transaction('rw', db.sync_state, async () => {
    const entry = await db.sync_state.get('device_id');
    if (typeof entry?.value === 'string') {
      return entry.value;
    }
    const id = create();
    await db.sync_state.put({ key: 'device_id', value: id });
    return id;
  });
}
