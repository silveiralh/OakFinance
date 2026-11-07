// T-078: conciliador no aparelho depois do pull (US-48; RN-61, RN-65..RN-68, RN-72; tech §4.6 passo 6).
import { Dexie } from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { type LocalRow, OakDb } from '../../src/data/db';
import { SyncEngine } from '../../src/data/sync/engine';
import { RECONCILE_KEY, runReconcile } from '../../src/data/sync/reconcile-runner';
import { FakeServer } from './fake-server';
import { makeRow, tx } from './rows';

const NUBANK = 'card-nubank';
const BB = 'conta-bb';
const NOW = Date.parse('2026-11-10T12:00:00.000Z');

const opened: OakDb[] = [];
function open() {
  const db = new OakDb(`recon-${opened.length}-${Math.random()}`);
  opened.push(db);
  return db;
}
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
    await Dexie.delete(db.name);
  }
});

type Meio = 'credito' | 'pix' | 'debito';
function where(meio: Meio): Partial<LocalRow<'transactions'>> {
  return meio === 'credito'
    ? { card_id: NUBANK, account_id: null, payment_method: 'credit', invoice_id: 'inv-1' }
    : { account_id: BB, card_id: null, payment_method: meio === 'pix' ? 'pix' : 'debit' };
}

function manual(
  id: string,
  meio: Meio,
  cents: number,
  on: string,
  extra: Partial<LocalRow<'transactions'>> = {},
) {
  return tx(id, {
    ...where(meio),
    amount_cents: cents,
    occurred_on: on,
    source: 'manual',
    review_state: 'ok',
    server_version: 0,
    ...extra,
  });
}

let version = 0;
function imported(
  id: string,
  meio: Meio,
  cents: number,
  on: string,
  extra: Partial<LocalRow<'transactions'>> = {},
) {
  version += 1;
  return tx(id, {
    ...where(meio),
    amount_cents: cents,
    occurred_on: on,
    source: 'pluggy',
    external_id: `ext-${id}`,
    review_state: 'new',
    category_id: 'cat-x',
    server_version: version,
    ...extra,
  });
}

async function state(db: OakDb, id: string) {
  const row = await db.transactions.get(id);
  return [row?.review_state, row?.duplicate_of];
}

describe('US-48: Esquema do Cenário "Decisão de conciliação"', () => {
  const cases: Array<
    [Meio, number, string, number, string, 'merged' | 'new' | 'suggested', string]
  > = [
    ['credito', 4590, '2026-11-05', 4590, '2026-11-07', 'merged', 'conciliado automaticamente'],
    ['credito', 4590, '2026-11-05', 4590, '2026-11-09', 'new', 'lançamento novo (fora de 3 dias)'],
    ['pix', 12000, '2026-11-05', 12000, '2026-11-06', 'merged', 'conciliado automaticamente'],
    ['pix', 12000, '2026-11-05', 12000, '2026-11-07', 'new', 'lançamento novo (fora de 1 dia)'],
    [
      'debito',
      5000,
      '2026-11-05',
      5150,
      '2026-11-05',
      'suggested',
      'pendente de decisão ("É o mesmo?")',
    ],
    [
      'debito',
      30000,
      '2026-11-05',
      30600,
      '2026-11-06',
      'suggested',
      'pendente de decisão (2% de 300 = 6,00)',
    ],
    ['debito', 30000, '2026-11-05', 30601, '2026-11-06', 'new', 'lançamento novo'],
  ];
  for (const [meio, valorL, dataL, valorT, dataT, expected, label] of cases) {
    it(`US-48: ${meio} ${valorL} em ${dataL} × ${valorT} em ${dataT} → ${label}`, async () => {
      const db = open();
      await db.transactions.bulkPut([
        manual('L', meio, valorL, dataL),
        imported('T', meio, valorT, dataT),
      ]);
      await runReconcile(db, { nowMs: NOW });
      const [review, dup] = await state(db, 'T');
      expect(review).toBe(expected);
      expect(dup).toBe(expected === 'merged' ? 'L' : null);
      const l = await db.transactions.get('L');
      expect(l?.matched_external).toBe(expected === 'merged');
    });
  }
});

describe('US-48: candidatos e resultado', () => {
  it('US-48: dois cafés iguais — concilia com a menor diferença de data e o segundo com o outro', async () => {
    const db = open();
    await db.transactions.bulkPut([
      manual('cafe-05', 'credito', 500, '2026-11-05'),
      manual('cafe-06', 'credito', 500, '2026-11-06'),
      imported('T1', 'credito', 500, '2026-11-06'),
    ]);
    await runReconcile(db, { nowMs: NOW });
    expect(await state(db, 'T1')).toEqual(['merged', 'cafe-06']);
    // chega outra de R$ 5,00 em 06/11 no pull seguinte
    await db.transactions.put(imported('T2', 'credito', 500, '2026-11-06'));
    await runReconcile(db, { nowMs: NOW });
    expect(await state(db, 'T2')).toEqual(['merged', 'cafe-05']);
  });

  it('US-48: empate verdadeiro fica pendente de decisão e fora dos agregados', async () => {
    const db = open();
    await db.transactions.bulkPut([
      manual('a', 'credito', 500, '2026-11-05'),
      manual('b', 'credito', 500, '2026-11-05'),
      imported('T', 'credito', 500, '2026-11-06'),
    ]);
    const summary = await runReconcile(db, { nowMs: NOW });
    expect(summary).toMatchObject({ checked: 1, suggested: 1, merged: 0 });
    expect(await state(db, 'T')).toEqual(['suggested', null]);
    expect((await db.transactions.get('a'))?.matched_external).toBe(false);
  });

  it('US-48 / RN-68: o resultado preserva descrição e categoria do que eu escrevi', async () => {
    const db = open();
    await db.transactions.bulkPut([
      manual('L', 'debito', 8000, '2026-11-05', {
        description: 'Mercado do Zé',
        category_id: 'mercado',
        status: 'pending',
      }),
      imported('T', 'debito', 8000, '2026-11-05', {
        description: 'SUPERMERC ZE LTDA 4432',
        category_id: 'outra',
      }),
    ]);
    await runReconcile(db, { nowMs: NOW });
    const l = await db.transactions.get('L');
    expect([l?.description, l?.category_id, l?.matched_external, l?.status]).toEqual([
      'Mercado do Zé',
      'mercado',
      true,
      'posted',
    ]);
    expect(await state(db, 'T')).toEqual(['merged', 'L']);
    // RN-68: manual sem descrição recebe a do banco
    const db2 = open();
    await db2.transactions.bulkPut([
      manual('L', 'pix', 2000, '2026-11-05', { description: null }),
      imported('T', 'pix', 2000, '2026-11-05', { description: 'PIX PADARIA EXEMPLO' }),
    ]);
    await runReconcile(db2, { nowMs: NOW });
    expect((await db2.transactions.get('L'))?.description).toBe('PIX PADARIA EXEMPLO');
  });

  it('RN-19: fatura informada pelo banco prevalece no manual conciliado', async () => {
    const db = open();
    await db.transactions.bulkPut([
      manual('L', 'credito', 4590, '2026-11-05', { invoice_id: 'inv-calculada' }),
      imported('T', 'credito', 4590, '2026-11-06', {
        invoice_id: 'inv-do-banco',
        invoice_pinned: true,
      }),
    ]);
    await runReconcile(db, { nowMs: NOW });
    const l = await db.transactions.get('L');
    expect([l?.invoice_id, l?.invoice_pinned]).toEqual(['inv-do-banco', true]);
  });

  it('RN-72: a mesma transação vinda de outra fonte vira duplicada da existente', async () => {
    const db = open();
    await db.transactions.bulkPut([
      imported('P', 'debito', 7000, '2026-11-05', { review_state: 'ok', server_version: 0 }),
      imported('O', 'debito', 7000, '2026-11-06', { source: 'ofx' }),
    ]);
    const summary = await runReconcile(db, { nowMs: NOW });
    expect(summary.duplicates).toBe(1);
    expect(await state(db, 'O')).toEqual(['merged', 'P']);
  });

  it('RN-61: importado novo sem categoria recebe "A classificar"; receita sem categoria fica como está', async () => {
    const db = open();
    await db.categories.put(
      makeRow('categories', {
        id: 'cat-unc',
        slug: 'a-classificar',
        kind: 'expense',
        bucket: 'none',
        deleted_at: null,
      }),
    );
    await db.transactions.bulkPut([
      imported('T', 'debito', 1234, '2026-11-05', { category_id: null }),
      imported('R', 'pix', 5000, '2026-11-05', { category_id: null, kind: 'income' }),
    ]);
    const summary = await runReconcile(db, { nowMs: NOW });
    expect(summary).toMatchObject({ checked: 2, fresh: 2 });
    const t = await db.transactions.get('T');
    expect([t?.review_state, t?.category_id, t?.category_source]).toEqual([
      'new',
      'cat-unc',
      'none',
    ]);
    expect((await db.transactions.get('R'))?.category_id).toBeNull();
  });

  it('roda só para os importados que chegaram desde a última rodada, e as escritas vão para a outbox', async () => {
    const db = open();
    await db.transactions.bulkPut([
      manual('L', 'pix', 900, '2026-11-05'),
      imported('T', 'pix', 900, '2026-11-05'),
    ]);
    const first = await runReconcile(db, { nowMs: NOW });
    expect(first.merged).toBe(1);
    const outbox = await db.outbox.toArray();
    expect(outbox.map((e) => e.row_id).sort()).toEqual(['L', 'T']);
    expect((await db.kv.get(RECONCILE_KEY))?.value).toBe(
      (await db.transactions.get('T'))?.server_version,
    );
    // novo importado já visto (versão antiga) não volta a ser avaliado
    await db.transactions.put(imported('velho', 'pix', 900, '2026-11-05', { server_version: 0 }));
    expect((await runReconcile(db, { nowMs: NOW })).checked).toBe(0);
    // manual e excluídos não são candidatos
    await db.transactions.put(
      imported('apagado', 'pix', 900, '2026-11-05', { deleted_at: '2026-11-06T00:00:00.000Z' }),
    );
    expect((await runReconcile(db, { nowMs: NOW })).checked).toBe(0);
  });
});

describe('motor de sync (tech §4.6 passo 6)', () => {
  it('US-48: depois do pull, o importado que chegou do servidor é conciliado com o manual do aparelho', async () => {
    const db = open();
    const server = new FakeServer();
    await db.transactions.put(manual('L', 'pix', 4500, '2026-11-05'));
    server.put('transactions', {
      ...imported('T', 'pix', 4500, '2026-11-05'),
      client_updated_at: '2026-11-06T00:00:00.000Z',
    } as never);
    const engine = new SyncEngine({
      db,
      transport: server.transport(),
      isOnline: () => true,
      isVisible: () => false,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    await engine.syncNow();
    expect(await state(db, 'T')).toEqual(['merged', 'L']);
    expect(engine.reconciled).toMatchObject({ merged: 1 });
    expect(engine.getSnapshot().pending).toBe(2);
  });
});
