import { Dexie } from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OakDb } from '../../src/data/db';
import {
  flushTelemetry,
  sanitizeContext,
  TELEMETRY_BATCH,
  TELEMETRY_KEY,
  TELEMETRY_MAX,
  track,
} from '../../src/lib/telemetry';
import { FakeServer } from './fake-server';

const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`tele-${opened.length}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

describe('telemetria (tech §7.3, RN-104)', () => {
  it('contexto só com chaves da allowlist e sem texto livre', () => {
    expect(
      sanitizeContext({
        table: 'transactions',
        count: 3,
        ok: true,
        description: 'Mercado',
        reason: 'texto com espaço',
        status: 'stale',
        amount_cents: 1000,
        duration_ms: Number.NaN,
        stale: false,
      }),
    ).toEqual({ table: 'transactions', count: 3, status: 'stale', stale: false });
  });

  it('enfileira no kv, recusa código fora do padrão e limita a fila', async () => {
    const db = open();
    expect(
      await track(db, {
        code: 'sync.done',
        context: { count: 1 },
        nowMs: 0,
        appVersion: '1',
        deviceId: 'd',
      }),
    ).toBe(true);
    expect(await track(db, { code: 'Erro Livre com texto' })).toBe(false);
    const [event] = ((await db.kv.get(TELEMETRY_KEY))?.value ?? []) as unknown[];
    expect(event).toEqual({
      at: '1970-01-01T00:00:00.000Z',
      level: 'info',
      code: 'sync.done',
      context: { count: 1 },
      app_version: '1',
      device_id: 'd',
    });
    for (let i = 0; i < TELEMETRY_MAX + 10; i += 1) {
      await track(db, { code: 'sync.done' });
    }
    expect((((await db.kv.get(TELEMETRY_KEY))?.value ?? []) as unknown[]).length).toBe(
      TELEMETRY_MAX,
    );
  });

  it('track nunca lança (banco fechado)', async () => {
    const db = open();
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('fechado'));
    expect(await track(db, { code: 'sync.done' })).toBe(false);
  });

  it('envia em lotes de 50 por log_events e para no primeiro erro', async () => {
    const db = open();
    const server = new FakeServer();
    for (let i = 0; i < 120; i += 1) {
      await track(db, { code: 'sync.done' });
    }
    server.failures.push(undefined as never, undefined as never, 'throw');
    server.failures.length = 0;
    expect(await flushTelemetry(db, server.transport())).toBe(120);
    const sizes = server.calls.map((c) => (c.args.p_events as unknown[]).length);
    expect(sizes).toEqual([TELEMETRY_BATCH, TELEMETRY_BATCH, 20]);
    await track(db, { code: 'sync.failed', level: 'error' });
    server.failures.push('throw');
    expect(await flushTelemetry(db, server.transport())).toBe(0);
    expect((((await db.kv.get(TELEMETRY_KEY))?.value ?? []) as unknown[]).length).toBe(1);
  });
});
