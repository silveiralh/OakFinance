// T-089 (parte 1): chamada do nfce-fetch e gravação da nota no aparelho (RN-83, RN-84; US-54, US-55; tech §6.2.3).
import type { NfceQr } from '@oakfinance/domain';
import { describe, expect, it } from 'vitest';
import type { AuthValue } from '../src/app/auth';
import type { OakDb } from '../src/data/db';
import {
  type NfceFetchResponse,
  type NfceRead,
  readNfce,
  receiptRows,
  saveNfce,
} from '../src/features/nfce/receipts';
import { fakeAuth } from './auth-fixture';
import { tx } from './data/rows';

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

const QR: NfceQr = {
  url: 'https://www.fazenda.pr.gov.br/nfce/qrcode?p=x',
  accessKey: 'chave-ficticia',
  uf: '41',
  issuedYearMonth: '2026-11',
  issuerCnpj: '12345678000100',
  model: '65',
  series: '001',
  number: '000000123',
  emissionType: '1',
  qrVersion: 2,
  env: 1,
  contingency: null,
};

const FULL: NfceRead = {
  status: 'full',
  receipt: {
    issuerName: 'SUPERMERCADO EXEMPLO',
    issuerCnpj: '12345678000100',
    issuedAt: '2026-11-06T18:42:07',
    items: [
      {
        description: 'BANANA KG',
        code: '1',
        quantityMilli: 1234,
        unit: 'KG',
        unitCents: 599,
        totalCents: 739,
      },
      {
        description: 'CAFE',
        code: null,
        quantityMilli: 1000,
        unit: 'UN',
        unitCents: 17996,
        totalCents: 17996,
      },
    ],
    discountCents: 0,
    totalCents: 18735,
  },
};

function client(outcome: { data: unknown; error: unknown } | Error) {
  return {
    functions: {
      invoke: (name: string, options: { body?: unknown }) => {
        expect(name).toBe('nfce-fetch');
        expect(options.body).toEqual({ qr: 'QR-CRU' });
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
      },
    },
  } as never;
}

describe('US-55: leitura pelo nfce-fetch', () => {
  it('US-54: resposta completa vira full', async () => {
    const data: NfceFetchResponse = {
      status: 'full',
      qr: QR,
      receipt: FULL.status === 'full' ? FULL.receipt : null,
    };
    expect(await readNfce(client({ data, error: null }), 'QR-CRU')).toEqual(FULL);
  });

  it('US-55: fallback da função, erro da chamada e timeout viram fallback com o código', async () => {
    expect(
      await readNfce(
        client({
          data: { status: 'fallback', qr: QR, receipt: null, errorCode: 'NFCE_CAPTCHA' },
          error: null,
        }),
        'QR-CRU',
      ),
    ).toEqual({ status: 'fallback', errorCode: 'NFCE_CAPTCHA' });
    expect(await readNfce(client({ data: null, error: new Error('x') }), 'QR-CRU')).toEqual({
      status: 'fallback',
      errorCode: 'NFCE_UNAVAILABLE',
      transient: true,
    });
    const slow = {
      functions: { invoke: () => new Promise(() => undefined) },
    } as never;
    expect(await readNfce(slow, 'QR-CRU', { timeoutMs: 5 })).toEqual({
      status: 'fallback',
      errorCode: 'NFCE_TIMEOUT',
      transient: true,
    });
  });

  it('US-55: sem rede a nota fica pendente, sem chamar a função', async () => {
    const never = {
      functions: { invoke: () => Promise.reject(new Error('não devia chamar')) },
    } as never;
    expect(await readNfce(never, 'QR-CRU', { isOnline: () => false })).toEqual({
      status: 'pending',
    });
  });
});

describe('RN-83/RN-84: gravação da nota', () => {
  it('RN-84: nota parcial guarda o CNPJ da chave, o código do erro e nenhum item', () => {
    let n = 0;
    const { receipt, items } = receiptRows(
      'u-1',
      { ...QR, contingency: { day: 3, totalCents: 2590 } },
      { status: 'fallback', errorCode: 'NFCE_TIMEOUT' },
      Date.parse('2026-11-07T12:00:00Z'),
      () => `id-${++n}`,
    );
    expect(receipt).toMatchObject({
      id: 'id-1',
      parse_status: 'fallback',
      error_code: 'NFCE_TIMEOUT',
      issuer_cnpj: '12345678000100',
      issuer_name: null,
      total_cents: 2590,
      items_count: null,
    });
    expect(items).toEqual([]);
    const pending = receiptRows('u-1', QR, { status: 'pending' }, 0, () => 'p');
    expect(pending.receipt).toMatchObject({
      parse_status: 'pending',
      fetched_at: null,
      total_cents: null,
    });
  });

  it('RN-83: enriquece o lançamento existente com loja e itens, sem criar outro', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    const manual = tx('manual', {
      amount_cents: 18735,
      occurred_on: '2026-11-06',
      description: '',
      nfce_receipt_id: null,
    });
    await db.transactions.put(manual);
    let n = 0;
    const rows = receiptRows('u-1', QR, FULL, Date.parse('2026-11-07T12:00:00Z'), () => `r-${++n}`);
    expect(
      rows.items.map((i) => [i.line_no, i.receipt_id, i.quantity_milli, i.total_cents]),
    ).toEqual([
      [1, 'r-1', 1234, 739],
      [2, 'r-1', 1000, 17996],
    ]);
    const saved = await saveNfce(db, rows, manual);
    expect(saved.ok).toBe(true);
    expect(await db.transactions.count()).toBe(1);
    expect(await db.transactions.get('manual')).toMatchObject({
      nfce_receipt_id: 'r-1',
      merchant_cnpj: '12345678000100',
      description: 'SUPERMERCADO EXEMPLO',
      _pending: 1,
    });
    expect(await db.receipt_items.where('receipt_id').equals('r-1').count()).toBe(2);
    expect((await db.outbox.toArray()).map((e) => e.table).sort()).toEqual([
      'nfce_receipts',
      'receipt_items',
      'receipt_items',
      'transactions',
    ]);
  });

  it('RN-83: descrição já preenchida fica; nova leitura reaproveita a nota pendente', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    const manual = tx('m2', {
      amount_cents: 18735,
      description: 'Mercado do mês',
      nfce_receipt_id: null,
    });
    const first = receiptRows('u-1', QR, { status: 'pending' }, 0, () => 'r-9');
    await saveNfce(db, first, null);
    const again = receiptRows('u-1', QR, FULL, 1000, () => 'item', first.receipt);
    expect(again.receipt.id).toBe('r-9');
    expect(again.receipt.created_at).toBe(first.receipt.created_at);
    await saveNfce(db, again, manual);
    expect((await db.transactions.get('m2'))?.description).toBe('Mercado do mês');
    expect((await db.nfce_receipts.get('r-9'))?.parse_status).toBe('full');
  });
});
