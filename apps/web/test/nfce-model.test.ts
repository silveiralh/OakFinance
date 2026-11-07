// T-089 (parte 1): regras do fluxo da nota (RN-83, RN-84, RN-85; US-54, US-55).
import type { ISODate, NfceQr } from '@oakfinance/domain';
import { describe, expect, it } from 'vitest';
import {
  canRetryRead,
  fallbackDraft,
  formatCnpj,
  nfceCandidate,
  repeatedReceipt,
  storeNameFor,
} from '../src/features/nfce/model';
import { makeRow, tx } from './data/rows';

const receipt = (id: string, overrides: Record<string, unknown> = {}) =>
  makeRow('nfce_receipts', {
    id,
    access_key: `chave-${id}`,
    issuer_cnpj: '12345678000100',
    issuer_name: null,
    parse_status: 'full',
    created_at: '2026-11-01T12:00:00.000Z',
    deleted_at: null,
    ...overrides,
  });

const qr = (overrides: Partial<NfceQr> = {}): NfceQr => ({
  url: 'https://www.fazenda.pr.gov.br/nfce/qrcode?p=x',
  accessKey: 'x',
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
  ...overrides,
});

describe('RN-83: lançamento candidato', () => {
  it('RN-83: valor exato, até 1 dia de diferença, qualquer conta; o mais próximo vence', () => {
    const rows = [
      tx('longe', {
        amount_cents: 18735,
        occurred_on: '2026-11-04',
        deleted_at: null,
        nfce_receipt_id: null,
      }),
      tx('ontem', {
        amount_cents: 18735,
        occurred_on: '2026-11-05',
        deleted_at: null,
        nfce_receipt_id: null,
        account_id: 'a2',
      }),
      tx('hoje', {
        amount_cents: 18735,
        occurred_on: '2026-11-06',
        deleted_at: null,
        nfce_receipt_id: null,
      }),
      tx('outro-valor', {
        amount_cents: 18736,
        occurred_on: '2026-11-06',
        deleted_at: null,
        nfce_receipt_id: null,
      }),
    ];
    expect(nfceCandidate(rows, '2026-11-06' as ISODate, 18735)?.id).toBe('hoje');
    expect(nfceCandidate(rows.slice(0, 2), '2026-11-06' as ISODate, 18735)?.id).toBe('ontem');
    expect(nfceCandidate(rows.slice(0, 1), '2026-11-06' as ISODate, 18735)).toBeNull();
  });

  it('RN-83: ignora excluídos, receitas e lançamentos que já têm nota', () => {
    const rows = [
      tx('excluido', {
        amount_cents: 500,
        occurred_on: '2026-11-06',
        deleted_at: '2026-11-06T00:00:00Z',
        nfce_receipt_id: null,
      }),
      tx('receita', {
        kind: 'income',
        amount_cents: 500,
        occurred_on: '2026-11-06',
        deleted_at: null,
        nfce_receipt_id: null,
      }),
      tx('com-nota', {
        amount_cents: 500,
        occurred_on: '2026-11-06',
        deleted_at: null,
        nfce_receipt_id: 'r-1',
      }),
    ];
    expect(nfceCandidate(rows, '2026-11-06' as ISODate, 500)).toBeNull();
  });
});

describe('RN-85: nota repetida', () => {
  it('RN-85: a mesma chave já lida é encontrada; excluída não conta', () => {
    const rows = [receipt('a'), receipt('b', { deleted_at: '2026-11-02T00:00:00Z' })];
    expect(repeatedReceipt(rows, 'chave-a')?.id).toBe('a');
    expect(repeatedReceipt(rows, 'chave-b')).toBeNull();
  });
});

describe('RN-84: fallback e nova tentativa', () => {
  it('RN-84: CNPJ formatado como descrição; hoje e valor em branco sem contingência', () => {
    expect(fallbackDraft(qr(), '2026-11-07' as ISODate)).toEqual({
      description: '12.345.678/0001-00',
      occurredOn: '2026-11-07',
      amountCents: null,
    });
    expect(formatCnpj('123')).toBe('123');
  });

  it('RN-84: QR de contingência traz o dia e o valor', () => {
    expect(
      fallbackDraft(qr({ contingency: { day: 3, totalCents: 2590 } }), '2026-11-07' as ISODate),
    ).toEqual({ description: '12.345.678/0001-00', occurredOn: '2026-11-03', amountCents: 2590 });
  });

  it('RN-84: "Tentar ler a nota de novo" por 7 dias, só para nota parcial', () => {
    const partial = receipt('p', {
      parse_status: 'fallback',
      created_at: '2026-11-01T12:00:00.000Z',
    });
    expect(canRetryRead(partial, '2026-11-08' as ISODate)).toBe(true);
    expect(canRetryRead(partial, '2026-11-09' as ISODate)).toBe(false);
    expect(canRetryRead(receipt('f'), '2026-11-02' as ISODate)).toBe(false);
    expect(
      canRetryRead(receipt('pend', { parse_status: 'pending' }), '2026-11-02' as ISODate),
    ).toBe(true);
  });

  it('RN-83: nome da loja lembrado pelo CNPJ, da nota mais recente', () => {
    const rows = [
      receipt('velha', { issuer_name: 'NOME ANTIGO', created_at: '2026-10-01T00:00:00Z' }),
      receipt('nova', { issuer_name: 'MERCADO EXEMPLO', created_at: '2026-11-01T00:00:00Z' }),
      receipt('sem-nome'),
    ];
    expect(storeNameFor(rows, '12345678000100')).toBe('MERCADO EXEMPLO');
    expect(storeNameFor(rows, '99999999000199')).toBeNull();
  });
});
