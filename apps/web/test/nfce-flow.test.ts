// T-089 (parte 1): fluxo da nota sem tela (US-54, US-55; RN-83, RN-84, RN-85). Chaves com DV válido geradas aqui.
import { accessKeyCheckDigit, type ISODate } from '@oakfinance/domain';
import { describe, expect, it } from 'vitest';
import type { AuthValue } from '../src/app/auth';
import type { OakDb } from '../src/data/db';
import {
  groupKey,
  processNfce,
  qrFromInput,
  rereadNfce,
  retryPendingNfce,
} from '../src/features/nfce/flow';
import type { NfceRead } from '../src/features/nfce/receipts';
import { fakeAuth } from './auth-fixture';
import { tx } from './data/rows';

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

function key(uf = '41', number = '000000123'): string {
  const first = `${uf}2611${'12345678000100'}65001${number}100000001`;
  return `${first}${accessKeyCheckDigit(first)}`;
}

const link = (k = key()) =>
  `https://www.fazenda.pr.gov.br/nfce/qrcode?p=${k}|2|1|1|ABCDEF0123456789`;
const TODAY = '2026-11-06' as ISODate;

const FULL: NfceRead = {
  status: 'full',
  receipt: {
    issuerName: 'SUPERMERCADO EXEMPLO',
    issuerCnpj: '12345678000100',
    issuedAt: '2026-11-06T18:42:07',
    items: [
      {
        description: 'ARROZ',
        code: null,
        quantityMilli: 1000,
        unit: 'UN',
        unitCents: 18735,
        totalCents: 18735,
      },
    ],
    discountCents: 0,
    totalCents: 18735,
  },
};

function deps(db: OakDb, read: NfceRead, calls: string[] = []) {
  return {
    db,
    userId: 'u-1',
    today: TODAY,
    nowMs: Date.parse('2026-11-06T21:00:00Z'),
    read: (raw: string) => {
      calls.push(raw);
      return Promise.resolve(read);
    },
  };
}

describe('US-54: entrada', () => {
  it('US-54: link colado passa; chave digitada (com espaços) vira URL do QR v3; resto é nulo', () => {
    expect(qrFromInput(` ${link()} `)).toBe(link());
    expect(qrFromInput(groupKey(key()))).toBe(
      `https://www.fazenda.pr.gov.br/nfce/qrcode?p=${key()}|3|1`,
    );
    expect(groupKey(key()).split(' ')).toHaveLength(11);
    expect(qrFromInput('123')).toBeNull();
  });
});

describe('US-54: fluxo da nota', () => {
  it('US-54: QR que não é de NFC-e ou com DV errado é inválido, sem chamar a função', async () => {
    const db = dbOf(fakeAuth());
    const calls: string[] = [];
    expect(await processNfce('https://example.test/x', deps(db, FULL, calls))).toEqual({
      kind: 'invalid',
    });
    const wrong = `${key().slice(0, 43)}${(Number(key()[43]) + 1) % 10}`;
    expect(await processNfce(wrong, deps(db, FULL, calls))).toEqual({ kind: 'invalid' });
    expect(await processNfce('qualquer coisa', deps(db, FULL, calls))).toEqual({ kind: 'invalid' });
    expect(calls).toEqual([]);
  });

  it('US-54: nota nova sem lançamento abre o Q01 com valor, data e loja', async () => {
    const db = dbOf(fakeAuth());
    const outcome = await processNfce(link(), deps(db, FULL));
    expect(outcome.kind).toBe('prefill');
    if (outcome.kind !== 'prefill') {
      return;
    }
    expect(outcome.read).toBe('full');
    expect(outcome.draft).toEqual({
      description: 'SUPERMERCADO EXEMPLO',
      occurredOn: '2026-11-06',
      amountCents: 18735,
    });
    expect(await db.transactions.count()).toBe(0);
    expect(await db.nfce_receipts.count()).toBe(1);
  });

  it('US-54: nota de um gasto já lançado anexa os itens e não cria nada', async () => {
    const db = dbOf(fakeAuth());
    await db.transactions.put(
      tx('manual', {
        amount_cents: 18735,
        occurred_on: '2026-11-06',
        nfce_receipt_id: null,
        deleted_at: null,
      }),
    );
    const outcome = await processNfce(link(), deps(db, FULL));
    expect(outcome.kind).toBe('attached');
    expect(await db.transactions.count()).toBe(1);
    expect((await db.transactions.get('manual'))?.nfce_receipt_id).toBe(
      outcome.kind === 'attached' ? outcome.receipt.id : 'x',
    );
  });

  it('RN-85: mesma nota de novo mostra a leitura anterior e o lançamento, sem chamar a função', async () => {
    const db = dbOf(fakeAuth());
    await db.transactions.put(
      tx('manual', {
        amount_cents: 18735,
        occurred_on: '2026-11-06',
        nfce_receipt_id: null,
        deleted_at: null,
      }),
    );
    await processNfce(link(), deps(db, FULL));
    const calls: string[] = [];
    const again = await processNfce(link(), deps(db, FULL, calls));
    expect(again).toMatchObject({ kind: 'repeated', txId: 'manual' });
    expect(calls).toEqual([]);
  });

  it('US-55: UF ≠ 41, SEFAZ fora ou sem rede: fallback com o CNPJ formatado e o valor em branco', async () => {
    const db = dbOf(fakeAuth());
    const outcome = await processNfce(
      link(key('35')),
      deps(db, { status: 'fallback', errorCode: 'NFCE_UNAVAILABLE' }),
    );
    expect(outcome).toMatchObject({
      kind: 'prefill',
      read: 'fallback',
      draft: { description: '12.345.678/0001-00', occurredOn: TODAY, amountCents: null },
    });
    const offline = await processNfce(
      link(key('41', '000000124')),
      deps(db, { status: 'pending' }),
    );
    expect(offline).toMatchObject({ kind: 'prefill', read: 'pending' });
    expect((await db.nfce_receipts.toArray()).map((r) => r.parse_status).sort()).toEqual([
      'fallback',
      'pending',
    ]);
  });

  it('US-55: a nota pendente é lida de novo quando a rede volta, na mesma linha, e lembra a loja', async () => {
    const db = dbOf(fakeAuth());
    await processNfce(link(), deps(db, { status: 'pending' }));
    const first = await db.nfce_receipts.toArray();
    const outcome = await processNfce(link(), deps(db, FULL));
    expect(outcome.kind).toBe('prefill');
    const after = await db.nfce_receipts.toArray();
    expect(after.map((r) => [r.id, r.parse_status])).toEqual([[first[0]?.id, 'full']]);
    // outra nota do mesmo CNPJ que falhe usa o nome lembrado
    const other = await processNfce(
      link(key('41', '000000999')),
      deps(db, { status: 'fallback', errorCode: 'NFCE_LAYOUT' }),
    );
    expect(other).toMatchObject({
      kind: 'prefill',
      draft: { description: 'SUPERMERCADO EXEMPLO' },
    });
  });
});

describe('US-55/RN-84: ler de novo', () => {
  async function pendingWithTx(db: OakDb, read: NfceRead = { status: 'pending' }) {
    const outcome = await processNfce(link(), deps(db, read));
    if (outcome.kind !== 'prefill') {
      throw new Error('esperava prefill');
    }
    // o Q01 salvou o lançamento com o rascunho (descrição = CNPJ formatado) ligado à nota
    await db.transactions.put(
      tx('nota', {
        amount_cents: 18735,
        occurred_on: TODAY,
        description: outcome.draft.description,
        nfce_receipt_id: outcome.receipt.id,
        source: 'nfce',
        deleted_at: null,
      }),
    );
    return outcome.receipt;
  }

  it('US-55: ao voltar a rede, a pendente fica completa e o lançamento recebe a loja e os itens', async () => {
    const db = dbOf(fakeAuth());
    const receipt = await pendingWithTx(db);
    expect(await retryPendingNfce(deps(db, FULL))).toEqual({ full: 1, pending: 0 });
    const after = await db.nfce_receipts.get(receipt.id);
    expect(after?.parse_status).toBe('full');
    expect(await db.receipt_items.where('receipt_id').equals(receipt.id).count()).toBe(1);
    const row = await db.transactions.get('nota');
    expect(row?.description).toBe('SUPERMERCADO EXEMPLO');
    expect(row?.merchant_cnpj).toBe('12345678000100');
    expect(row?.nfce_receipt_id).toBe(receipt.id);
  });

  it('US-55: ainda sem rede, continua pendente e nada muda', async () => {
    const db = dbOf(fakeAuth());
    const receipt = await pendingWithTx(db);
    expect(await retryPendingNfce(deps(db, { status: 'pending' }))).toEqual({
      full: 0,
      pending: 1,
    });
    expect((await db.nfce_receipts.get(receipt.id))?.parse_status).toBe('pending');
  });

  it('US-55: falha da chamada logo depois de a rede voltar mantém a nota pendente (não vira parcial)', async () => {
    const db = dbOf(fakeAuth());
    const receipt = await pendingWithTx(db);
    const flaky: NfceRead = { status: 'fallback', errorCode: 'NFCE_UNAVAILABLE', transient: true };
    expect(await retryPendingNfce(deps(db, flaky))).toEqual({ full: 0, pending: 1 });
    expect((await db.nfce_receipts.get(receipt.id))?.parse_status).toBe('pending');
    // a SEFAZ respondeu sem a nota: aí vira parcial
    expect(
      await retryPendingNfce(deps(db, { status: 'fallback', errorCode: 'NFCE_LAYOUT' })),
    ).toEqual({ full: 0, pending: 0 });
    expect((await db.nfce_receipts.get(receipt.id))?.parse_status).toBe('fallback');
  });

  it('RN-84: descrição escrita pelo usuário não é trocada pelo nome da loja', async () => {
    const db = dbOf(fakeAuth());
    const receipt = await pendingWithTx(db);
    const row = await db.transactions.get('nota');
    await db.transactions.put({
      ...(row as NonNullable<typeof row>),
      description: 'Compras do mês',
    });
    await rereadNfce(receipt, deps(db, FULL));
    expect((await db.transactions.get('nota'))?.description).toBe('Compras do mês');
  });

  it('RN-84: depois de 7 dias a pendente não é mais relida', async () => {
    const db = dbOf(fakeAuth());
    await pendingWithTx(db);
    const calls: string[] = [];
    const late = { ...deps(db, FULL, calls), today: '2026-11-14' as ISODate };
    expect(await retryPendingNfce(late)).toEqual({ full: 0, pending: 0 });
    expect(calls).toEqual([]);
  });

  it('RN-84: "Tentar ler a nota de novo" na parcial que continua parcial não regrava', async () => {
    const db = dbOf(fakeAuth());
    const receipt = await pendingWithTx(db, { status: 'fallback', errorCode: 'NFCE_LAYOUT' });
    const stored = await db.nfce_receipts.get(receipt.id);
    expect(
      await rereadNfce(
        stored as NonNullable<typeof stored>,
        deps(db, { status: 'fallback', errorCode: 'NFCE_LAYOUT' }),
      ),
    ).toBe('fallback');
    expect((await db.nfce_receipts.get(receipt.id))?.updated_at).toBe(stored?.updated_at);
    const stored2 = await db.nfce_receipts.get(receipt.id);
    expect(await rereadNfce(stored2 as NonNullable<typeof stored2>, deps(db, FULL))).toBe('full');
  });
});
