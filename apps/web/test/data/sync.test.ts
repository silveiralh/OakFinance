import { Dexie } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OakDb } from '../../src/data/db';
import { saveRow } from '../../src/data/repositories/rows';
import {
  BACKOFF_MS,
  backoffDelay,
  type LockManagerLike,
  POLL_IDLE_MS,
  POLL_PENDING_MS,
  SyncEngine,
  WRITE_DEBOUNCE_MS,
} from '../../src/data/sync/engine';
import { enqueue } from '../../src/data/sync/outbox';
import {
  pullChanges,
  purgeLocalTombstones,
  readCursor,
  resetLocalData,
} from '../../src/data/sync/pull';
import { MAX_BATCHES, pushOutbox } from '../../src/data/sync/push';
import { callRpc, classifyFailure, fromSupabase, RpcFailure } from '../../src/data/sync/transport';
import { TELEMETRY_KEY } from '../../src/lib/telemetry';
import { FakeServer } from './fake-server';
import { makeRow, tx } from './rows';

const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`sync-${opened.length}-${Math.random().toString(36).slice(2)}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

/** Timers manuais: o teste dispara quando quiser. */
function manualTimers() {
  const timers = new Map<number, { cb: () => void; ms: number }>();
  let id = 0;
  return {
    timers,
    setTimer: (cb: () => void, ms: number) => {
      id += 1;
      timers.set(id, { cb, ms });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    delays: () => [...timers.values()].map((t) => t.ms),
    fireAll: () => {
      const all = [...timers.values()];
      timers.clear();
      for (const t of all) {
        t.cb();
      }
    },
  };
}

/** Liga os gatilhos com alvos falsos e espera o ciclo da abertura. */
async function started(e: SyncEngine) {
  const win = new EventTarget();
  const doc = new EventTarget();
  const stop = e.start(win as unknown as Window, doc as unknown as Document);
  await e.syncNow();
  return { win, doc, stop };
}

function engine(
  db: OakDb,
  server: FakeServer,
  extra: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {},
) {
  const timers = manualTimers();
  const e = new SyncEngine({
    db,
    transport: server.transport(),
    random: () => 0.5,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    isOnline: () => true,
    isVisible: () => true,
    ...extra,
  });
  return { e, timers };
}

describe('backoff da RN-96 (tech §4.5)', () => {
  it('5 s, 15 s, 1 min, 5 min e depois 5 min, com jitter de ±20%', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => backoffDelay(n, () => 0.5))).toEqual([
      5_000, 15_000, 60_000, 300_000, 300_000, 300_000,
    ]);
    expect(backoffDelay(1, () => 0)).toBe(4_000);
    expect(backoffDelay(1, () => 1)).toBe(6_000);
    expect(backoffDelay(0, () => 0.5)).toBe(BACKOFF_MS[0]);
  });
});

describe('transporte', () => {
  it('classifica rede/5xx/timeout (tenta de novo), 401 (espera login) e o resto', () => {
    expect(classifyFailure({ error: { message: 'x' }, status: 0 })).toBe('retry');
    expect(classifyFailure({ error: {}, status: 503 })).toBe('retry');
    expect(classifyFailure({ error: {}, status: 429 })).toBe('retry');
    expect(classifyFailure({ error: {}, status: 401 })).toBe('auth');
    expect(classifyFailure({ error: { code: '28000' }, status: 400 })).toBe('auth');
    expect(classifyFailure({ error: { code: 'PGRST301' }, status: 400 })).toBe('auth');
    expect(classifyFailure({ error: { code: '22023' }, status: 400 })).toBe('fatal');
  });

  it('callRpc: timeout de 15 s, exceção de rede e erro com código', async () => {
    const server = new FakeServer();
    server.failures.push('hang', 'throw', { data: null, error: { code: '22023' }, status: 400 });
    await expect(callRpc(server.transport(), 'sync_pull', {}, 20)).rejects.toMatchObject({
      kind: 'retry',
      code: 'TIMEOUT',
    });
    await expect(callRpc(server.transport(), 'sync_pull', {})).rejects.toMatchObject({
      kind: 'retry',
      code: 'NETWORK',
    });
    await expect(callRpc(server.transport(), 'sync_pull', {})).rejects.toMatchObject({
      kind: 'fatal',
      code: '22023',
    });
    server.failures.push({ data: null, error: {}, status: 502 });
    await expect(callRpc(server.transport(), 'sync_pull', {})).rejects.toMatchObject({
      code: 'HTTP_502',
    });
  });

  it('fromSupabase usa getSession e abortSignal do supabase-js', async () => {
    const abortSignal = vi.fn(() => Promise.resolve({ data: { ok: 1 }, error: null, status: 200 }));
    const client = {
      auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'x' } } }) },
      rpc: vi.fn(() =>
        Object.assign(Promise.resolve({ data: null, error: null, status: 200 }), { abortSignal }),
      ),
    };
    const transport = fromSupabase(client);
    expect(await transport.hasSession()).toBe(true);
    const signal = new AbortController().signal;
    expect(await transport.rpc('sync_pull', { p_since: 0 }, signal)).toMatchObject({
      data: { ok: 1 },
    });
    expect(client.rpc).toHaveBeenCalledWith('sync_pull', { p_since: 0 });
    expect(abortSignal).toHaveBeenCalledWith(signal);
    const plain = fromSupabase({
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      rpc: () => Promise.resolve({ data: 2, error: null, status: 200 }),
    });
    expect(await plain.hasSession()).toBe(false);
    expect(await plain.rpc('log_events', {}, signal)).toMatchObject({ data: 2 });
  });
});

describe('push (tech §4.5 e §4.10)', () => {
  it('applied tira da fila e limpa _pending; mesma mutação de novo vira duplicate sem efeito', async () => {
    const db = open();
    const server = new FakeServer();
    await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    const [entry] = await db.outbox.toArray();
    const summary = await pushOutbox(db, server.transport(), 'dev');
    expect(summary).toMatchObject({ batches: 1, applied: 1, stale: 0, failure: null });
    expect(await db.outbox.count()).toBe(0);
    expect((await db.transactions.get('t1'))?._pending).toBe(0);
    // resposta perdida: a mesma mutação sobe de novo
    await db.outbox.add({
      ...(entry as NonNullable<typeof entry>),
      seq: undefined as never,
      state: 'queued',
    });
    const again = await pushOutbox(db, server.transport(), 'dev');
    expect(again.applied).toBe(1);
    expect(server.rows.size).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('stale: grava a linha do servidor e remove da fila', async () => {
    const db = open();
    const server = new FakeServer();
    server.put('transactions', {
      ...tx('t1', { amount_cents: 9999 }),
      client_updated_at: '2026-11-06T13:00:00.000Z',
    });
    await saveRow(db, 'transactions', tx('t1', { amount_cents: 1 }), { nowMs: T0 });
    const summary = await pushOutbox(db, server.transport(), 'dev');
    expect(summary.stale).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.transactions.get('t1')).toMatchObject({ amount_cents: 9999, _pending: 0 });
  });

  it('stale com outra edição local na fila mantém a linha local', async () => {
    const db = open();
    const server = new FakeServer();
    server.put('transactions', {
      ...tx('t1', { amount_cents: 9999 }),
      client_updated_at: '2026-11-06T13:00:00.000Z',
    });
    await saveRow(db, 'transactions', tx('t1', { amount_cents: 1 }), { nowMs: T0 });
    const original = server.transport();
    const transport = {
      ...original,
      rpc: async <T>(
        name: Parameters<typeof original.rpc>[0],
        args: Record<string, unknown>,
        signal: AbortSignal,
      ) => {
        // o usuário editou de novo enquanto o lote estava no ar
        await saveRow(db, 'transactions', tx('t1', { amount_cents: 2 }), { nowMs: T0 + 10 });
        return original.rpc<T>(name, args, signal);
      },
    };
    await pushOutbox(db, transport, 'dev', 1);
    expect(await db.transactions.get('t1')).toMatchObject({ amount_cents: 2, _pending: 1 });
    expect(await db.outbox.count()).toBe(1);
  });

  it('rejected (FK): fica na fila como rejected com o código', async () => {
    const db = open();
    const server = new FakeServer();
    server.rejectTables.add('transactions');
    await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    const summary = await pushOutbox(db, server.transport(), 'dev');
    expect(summary.rejected).toEqual([{ table: 'transactions', code: '23503' }]);
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ state: 'rejected', last_error: '23503' }),
    ]);
  });

  it('falha de rede: o lote volta para queued com attempts + 1', async () => {
    const db = open();
    const server = new FakeServer();
    server.failures.push('throw');
    await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    const summary = await pushOutbox(db, server.transport(), 'dev');
    expect(summary.failure).toBeInstanceOf(RpcFailure);
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ state: 'queued', attempts: 1 }),
    ]);
  });

  it('resposta sem formato ou sem o resultado de uma mutação: volta para a fila', async () => {
    const db = open();
    const server = new FakeServer();
    server.failures.push({ data: { nada: 1 } as never, error: null, status: 200 });
    await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    expect((await pushOutbox(db, server.transport(), 'dev')).failure?.code).toBe('BAD_RESPONSE');
    server.failures.push({
      data: { results: [{ mutation_id: 'outra', status: 'applied' }] } as never,
      error: null,
      status: 200,
    });
    await pushOutbox(db, server.transport(), 'dev', 1);
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ state: 'queued', attempts: 2 }),
    ]);
  });

  it('mais de 1.000 entradas: lotes de 200, até 10 por ciclo (§4.10)', async () => {
    const db = open();
    const server = new FakeServer();
    await db.transaction('rw', db.outbox, async () => {
      for (let i = 0; i < 2_100; i += 1) {
        await enqueue(db, {
          table: 'transactions',
          rowId: `t${i}`,
          row: { ...tx(`t${i}`) },
          createdAt: 'x',
        });
      }
    });
    const summary = await pushOutbox(db, server.transport(), 'dev');
    expect(summary.batches).toBe(MAX_BATCHES);
    expect(summary.applied).toBe(2_000);
    expect(await db.outbox.count()).toBe(100);
    const sizes = server.calls.map((c) => (c.args.p_mutations as unknown[]).length);
    expect(Math.max(...sizes)).toBe(200);
  });
});

describe('pull (tech §4.6 e §4.10)', () => {
  it('páginas por cursor, gravado na transação de cada página', async () => {
    const db = open();
    const server = new FakeServer();
    for (let i = 0; i < 1_200; i += 1) {
      server.put('transactions', tx(`t${i}`));
    }
    const summary = await pullChanges(db, server.transport());
    expect(summary).toMatchObject({ pages: 3, rows: 1_200, reset: false, failure: null });
    expect(await readCursor(db)).toBe(1_200);
    expect(await db.transactions.count()).toBe(1_200);
    expect(server.calls.map((c) => c.args.p_since)).toEqual([0, 500, 1_000]);
  });

  it('protege a edição local mais nova que ainda vai subir; aplica a do servidor se for mais nova', async () => {
    const db = open();
    const server = new FakeServer();
    await saveRow(db, 'transactions', tx('t1', { amount_cents: 1 }), { nowMs: T0 });
    await saveRow(db, 'transactions', tx('t2', { amount_cents: 1 }), { nowMs: T0 });
    server.put('transactions', {
      ...tx('t1', { amount_cents: 7 }),
      client_updated_at: '2026-11-06T11:00:00.000Z',
    });
    server.put('transactions', {
      ...tx('t2', { amount_cents: 8 }),
      client_updated_at: '2026-11-06T13:00:00.000Z',
    });
    const summary = await pullChanges(db, server.transport());
    expect(summary.skipped).toBe(1);
    expect(await db.transactions.get('t1')).toMatchObject({ amount_cents: 1, _pending: 1 });
    expect(await db.transactions.get('t2')).toMatchObject({ amount_cents: 8, _pending: 1 });
  });

  it('reset_required: apaga as tabelas, preserva outbox e kv, e refaz o pull do zero', async () => {
    const db = open();
    const server = new FakeServer();
    await db.transactions.put(tx('velha'));
    await db.sync_state.put({ key: 'cursor', value: 3 });
    await db.kv.put({ key: 'aba', value: 'x' });
    await enqueue(db, { table: 'transactions', rowId: 'local', row: {}, createdAt: 'x' });
    server.put('transactions', tx('nova'));
    server.horizon = 10;
    const summary = await pullChanges(db, server.transport());
    expect(summary.reset).toBe(true);
    expect((await db.transactions.toArray()).map((r) => r.id)).toEqual(['nova']);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.kv.get('aba')).toBeDefined();
    expect(await readCursor(db)).toBe(1);
  });

  it('reset em laço, tabela desconhecida, linha inválida e falha de rede', async () => {
    const db = open();
    const server = new FakeServer();
    server.failures.push(
      { data: { reset_required: true } as never, error: null, status: 200 },
      { data: { reset_required: true } as never, error: null, status: 200 },
    );
    expect((await pullChanges(db, server.transport())).failure?.code).toBe('RESET_LOOP');
    server.failures.push({
      data: {
        rows: [
          { t: 'notification_outbox', v: 1, r: { id: 'x' } },
          { t: 'transactions', v: 2, r: { id: 'quebrada' } },
          { t: 'transactions', v: 3, r: tx('boa') },
        ],
        next: 3,
        has_more: false,
      } as never,
      error: null,
      status: 200,
    });
    const summary = await pullChanges(db, server.transport());
    expect(summary).toMatchObject({ rows: 1, skipped: 2 });
    expect(await readCursor(db)).toBe(3);
    server.failures.push('throw');
    expect((await pullChanges(db, server.transport())).failure?.kind).toBe('retry');
    server.failures.push({ data: null, error: null, status: 200 });
    expect((await pullChanges(db, server.transport())).failure?.code).toBe('BAD_RESPONSE');
  });

  it('relógio: o server_time do pull ajusta o deslocamento', async () => {
    const db = open();
    const server = new FakeServer();
    server.serverTime = () => new Date(T0 + 1000).toISOString();
    await pullChanges(db, server.transport(), () => T0);
    expect((await db.sync_state.get('server_offset_ms'))?.value).toBe(1000);
  });

  it('expurgo local de tombstones com mais de 30 dias e sem pendência', async () => {
    const db = open();
    await db.transactions.bulkPut([
      tx('velho', { deleted_at: '2026-09-01T00:00:00.000Z' }),
      tx('velho-pendente', { deleted_at: '2026-09-01T00:00:00.000Z', _pending: 1 }),
      tx('recente', { deleted_at: '2026-11-01T00:00:00.000Z' }),
      tx('vivo'),
    ]);
    await db.cards.put(makeRow('cards', { id: 'c', deleted_at: '2026-01-01T00:00:00.000Z' }));
    expect(await purgeLocalTombstones(db, T0)).toBe(2);
    expect((await db.transactions.toArray()).map((r) => r.id).sort()).toEqual([
      'recente',
      'velho-pendente',
      'vivo',
    ]);
    await resetLocalData(db);
    expect(await db.transactions.count()).toBe(0);
  });
});

describe('motor (tech §4.5 e §4.8, RN-96..RN-99)', () => {
  it('ciclo: push antes do pull, contadores, telemetria sync.done enviada por log_events', async () => {
    const db = open();
    const server = new FakeServer();
    const { e } = engine(db, server);
    await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    const result = await e.syncNow();
    expect(result).toEqual({ ran: true, ok: true, failure: null });
    expect(server.calls.map((c) => c.name)).toEqual(['sync_push', 'sync_pull', 'log_events']);
    expect(e.getSnapshot()).toMatchObject({ phase: 'done', pending: 0, consecutiveFailures: 0 });
    expect(server.events).toEqual([expect.objectContaining({ code: 'sync.done', level: 'info' })]);
    expect((await db.kv.get(TELEMETRY_KEY))?.value).toEqual([]);
  });

  it('RN-96: falhas seguidas aplicam o backoff e, na 3ª, ligam o G04; sucesso zera', async () => {
    const db = open();
    const server = new FakeServer();
    const { e, timers } = engine(db, server);
    await saveRow(db, 'transactions', tx('t1'), { nowMs: T0 });
    server.failures.push('throw', 'throw', 'throw');
    await started(e);
    expect(timers.delays()).toEqual([5_000]);
    await e.syncNow();
    expect(timers.delays()).toEqual([15_000]);
    expect(e.getSnapshot().showErrorBanner).toBe(false);
    await e.syncNow();
    expect(timers.delays()).toEqual([60_000]);
    expect(e.getSnapshot()).toMatchObject({
      phase: 'error',
      consecutiveFailures: 3,
      showErrorBanner: true,
      pending: 1,
    });
    await e.syncNow();
    expect(e.getSnapshot()).toMatchObject({
      phase: 'done',
      consecutiveFailures: 0,
      showErrorBanner: false,
    });
    const codes = server.events.map((ev) => (ev as { code: string }).code);
    expect(codes.filter((c) => c === 'sync.failed')).toHaveLength(3);
  });

  it('sem sessão ou 401: espera o login (G05), sem reagendar', async () => {
    const db = open();
    const server = new FakeServer();
    const { e, timers } = engine(db, server);
    await started(e);
    timers.timers.clear();
    server.session = false;
    expect(await e.syncNow()).toMatchObject({ ok: false, failure: 'auth' });
    expect(e.getSnapshot().phase).toBe('auth');
    server.session = true;
    server.failures.push({ data: null, error: { code: 'PGRST301' }, status: 401 });
    expect(await e.syncNow()).toMatchObject({ failure: 'auth' });
    expect(timers.delays()).toEqual([]);
  });

  it('offline: não chama a rede e marca o estado', async () => {
    const db = open();
    const server = new FakeServer();
    const { e } = engine(db, server, { isOnline: () => false });
    expect(await e.syncNow()).toEqual({ ran: false, ok: false, failure: null });
    expect(e.getSnapshot().phase).toBe('offline');
    expect(server.calls).toHaveLength(0);
  });

  it('duas abas: o Web Lock ocupado faz a segunda sair sem sincronizar (§4.10)', async () => {
    const db = open();
    const server = new FakeServer();
    const busy: LockManagerLike = { request: (_n, _o, cb) => cb(null) };
    const { e } = engine(db, server, { locks: busy });
    expect(await e.syncNow()).toEqual({ ran: false, ok: true, failure: null });
    expect(server.calls).toHaveLength(0);
  });

  it('chamadas simultâneas compartilham um ciclo; o trinco em memória serializa', async () => {
    const db = open();
    const server = new FakeServer();
    const { e } = engine(db, server);
    const [a, b] = await Promise.all([e.syncNow(), e.syncNow()]);
    expect(a).toBe(b);
    expect(server.calls.filter((c) => c.name === 'sync_pull')).toHaveLength(1);
  });

  it('agenda 60 s com outbox cheia, 5 min vazia e nada com o app em segundo plano', async () => {
    const db = open();
    const server = new FakeServer();
    server.rejectTables.add('cards');
    let visible = true;
    const { e, timers } = engine(db, server, { isVisible: () => visible });
    await started(e);
    expect(timers.delays()).toEqual([POLL_IDLE_MS]);
    await enqueue(db, { table: 'transactions', rowId: 'x', row: tx('x'), createdAt: 'x' });
    server.failures.push({ data: { results: [] } as never, error: null, status: 200 });
    await e.syncNow();
    expect(timers.delays()).toEqual([POLL_PENDING_MS]);
    visible = false;
    await e.syncNow();
    expect(timers.delays()).toEqual([]);
  });

  it('gatilhos: abertura, online, focus, visível e RUN_SYNC; escrita local com debounce de 2 s', async () => {
    const db = open();
    const server = new FakeServer();
    const { e, timers } = engine(db, server);
    const win = new EventTarget();
    const doc = new EventTarget();
    const spy = vi.spyOn(e, 'syncNow');
    const stop = e.start(win as unknown as Window, doc as unknown as Document);
    expect(spy).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(4);
    win.dispatchEvent(new Event('offline'));
    expect(e.getSnapshot().phase).toBe('offline');
    await e.syncNow();
    timers.timers.clear();
    e.notifyWrite();
    e.notifyWrite();
    expect(timers.delays()).toEqual([WRITE_DEBOUNCE_MS]);
    timers.fireAll();
    expect(spy).toHaveBeenCalledTimes(6);
    stop();
    win.dispatchEvent(new Event('online'));
    expect(spy).toHaveBeenCalledTimes(6);
    await Promise.all(spy.mock.results.map((r) => r.value));
  });

  it('rejeitada gera evento sync.rejected sem dados do lançamento', async () => {
    const db = open();
    const server = new FakeServer();
    server.rejectTables.add('transactions');
    const { e } = engine(db, server, { appVersion: '1.0.0' });
    await saveRow(db, 'transactions', tx('t1', { description: 'Mercado' }), { nowMs: T0 });
    await e.syncNow();
    expect(e.getSnapshot().rejected).toBe(1);
    const rejected = server.events.find((ev) => (ev as { code: string }).code === 'sync.rejected');
    expect(rejected).toMatchObject({
      level: 'warn',
      context: { table: 'transactions', reason: '23503' },
      app_version: '1.0.0',
    });
    expect(JSON.stringify(server.events)).not.toContain('Mercado');
  });

  it('subscribe avisa as mudanças de estado', async () => {
    const db = open();
    const server = new FakeServer();
    const { e } = engine(db, server);
    const listener = vi.fn();
    const off = e.subscribe(listener);
    await e.syncNow();
    expect(listener).toHaveBeenCalled();
    off();
  });
});
