import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import * as ids from '../src/ids.ts';

const USER = '0190f1a2-0000-7000-8000-000000000001';
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ids determinísticos (ADR-06)', () => {
  const all = [
    ids.invoiceId(USER, '2026-12'),
    ids.installmentTxId(USER, 1),
    ids.recurrenceTxId(USER, '2026-11-05'),
    ids.seedCategoryId(USER, 'mercado'),
    ids.seedRuleId(USER, 'ifood'),
    ids.seedReminderId(USER, 'daily_log'),
    ids.reserveGoalId(USER),
    ids.receiptItemId(USER, 1),
    ids.pluggyTxId(USER, 'tx-1'),
    ids.carryOverTxId(USER),
    ids.noticeId(USER, 'invoice_due:x:d3'),
    ids.monthClosingId(USER, '2026-11'),
  ];

  it('todos são UUID v5 e distintos entre si', () => {
    for (const id of all) {
      expect(id).toMatch(UUID_V5);
    }
    expect(new Set(all).size).toBe(all.length);
  });

  it('o mesmo insumo gera o mesmo id em qualquer aparelho', () => {
    expect(ids.invoiceId(USER, '2026-12')).toBe(ids.invoiceId(USER, '2026-12'));
    expect(ids.invoiceId(USER, '2026-12')).not.toBe(ids.invoiceId(USER, '2027-01'));
  });

  it('os namespaces estão fixos (mudar quebra ids já sincronizados)', () => {
    expect(ids.NS_INVOICE).toBe('81b5ff40-b11d-45b5-b47d-655b9b938598');
    expect(ids.invoiceId('00000000-0000-4000-8000-000000000001', '2026-12')).toBe(
      'eb9153f2-76d8-5162-bcad-9fe818531762', // calculado fora (Python uuid5) para conferir o v5
    );
    const namespaces = Object.entries(ids)
      .filter(([k]) => k.startsWith('NS_'))
      .map(([, v]) => v);
    expect(namespaces).toHaveLength(12);
    expect(new Set(namespaces).size).toBe(12);
  });
});

describe('DomainError', () => {
  it('carrega código estável e mensagem', () => {
    const error = new DomainError('INVALID_AMOUNT');
    expect(error.code).toBe('INVALID_AMOUNT');
    expect(error.message).toBe('INVALID_AMOUNT');
    expect(error.name).toBe('DomainError');
    expect(new DomainError('INVALID_DATE', 'x').message).toBe('x');
  });
});
