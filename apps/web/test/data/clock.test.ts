import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { OakDb } from '../../src/data/db';
import { newId } from '../../src/data/ids';
import {
  deviceId,
  hlcIso,
  hlcNow,
  MAX_RTT_MS,
  nextHlc,
  recordServerTime,
  updateServerOffset,
} from '../../src/data/sync/clock';

const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`clock-${opened.length}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

describe('relógio híbrido (tech §4.3, RN-97)', () => {
  it('max(agora + deslocamento, último + 1): nunca volta e nunca repete', () => {
    expect(nextHlc(T0, { serverOffsetMs: 0, hlcLastMs: 0 })).toBe(T0);
    expect(nextHlc(T0, { serverOffsetMs: -500, hlcLastMs: 0 })).toBe(T0 - 500);
    expect(nextHlc(T0, { serverOffsetMs: 0, hlcLastMs: T0 })).toBe(T0 + 1);
    expect(nextHlc(T0 - 10_000, { serverOffsetMs: 0, hlcLastMs: T0 })).toBe(T0 + 1);
    expect(hlcIso(T0 + 7)).toBe('2026-11-06T12:00:00.007Z');
  });

  it('hlcNow grava hlc_last: escritas no mesmo milissegundo saem em ordem', async () => {
    const db = open();
    const a = await hlcNow(db, T0);
    const b = await hlcNow(db, T0);
    const c = await hlcNow(db, T0 - 60_000); // relógio do aparelho voltou
    expect([a, b, c]).toEqual([
      '2026-11-06T12:00:00.000Z',
      '2026-11-06T12:00:00.001Z',
      '2026-11-06T12:00:00.002Z',
    ]);
    expect((await db.sync_state.get('hlc_last'))?.value).toBe(T0 + 2);
  });

  it('relógio do aparelho 1 h adiantado: o deslocamento do servidor corrige as próximas escritas (§4.10)', async () => {
    const db = open();
    const deviceNow = T0 + 3_600_000;
    const offset = await recordServerTime(db, {
      serverTime: new Date(T0 + 100).toISOString(),
      sentAtMs: deviceNow,
      receivedAtMs: deviceNow + 200,
    });
    expect(offset).toBe(-3_600_000);
    expect(await hlcNow(db, deviceNow + 1000)).toBe(hlcIso(T0 + 1000));
  });

  it('deslocamento: média móvel; amostra com RTT > 2 s, negativa ou inválida é ignorada', () => {
    const sample = (server: number, sent: number, rtt: number) => ({
      serverTime: new Date(server).toISOString(),
      sentAtMs: sent,
      receivedAtMs: sent + rtt,
    });
    expect(updateServerOffset(null, sample(T0 + 1100, T0, 200))).toBe(1000);
    expect(updateServerOffset(1000, sample(T0 + 2100, T0, 200))).toBe(1300);
    expect(updateServerOffset(1000, sample(T0 + 9000, T0, MAX_RTT_MS + 1))).toBe(1000);
    expect(updateServerOffset(null, sample(T0, T0, -1))).toBeNull();
    expect(
      updateServerOffset(5, { serverTime: 'ontem', sentAtMs: T0, receivedAtMs: T0 + 10 }),
    ).toBe(5);
  });

  it('amostra ignorada não grava nada', async () => {
    const db = open();
    expect(
      await recordServerTime(db, { serverTime: 'x', sentAtMs: T0, receivedAtMs: T0 + 1 }),
    ).toBeNull();
    expect(await db.sync_state.get('server_offset_ms')).toBeUndefined();
  });

  it('device_id: UUID v7 criado uma vez e reaproveitado', async () => {
    const db = open();
    const first = await deviceId(db);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await deviceId(db, () => 'outro')).toBe(first);
    expect(newId()).not.toBe(newId());
  });
});
