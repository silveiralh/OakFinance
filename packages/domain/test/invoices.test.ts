import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, addMonths, monthOf } from '../src/dates.ts';
import { carryOverTxId, invoiceId } from '../src/ids.ts';
import {
  bestPurchaseDay,
  CARRY_OVER_DESCRIPTION,
  cardAvailableLimit,
  carryOverCredit,
  currentOpenInvoice,
  ensureInvoices,
  type InvoiceTotals,
  invoiceForPurchase,
  invoicePeriod,
  invoiceStatus,
  invoiceTotals,
  reassignCardItems,
} from '../src/invoices.ts';
import type { Card, Tx } from '../src/types.ts';

const RUNS = { numRuns: 200 };

function card(
  closingDay: number,
  dueDay: number,
  rule: 'next' | 'same' = 'next',
  limitCents: number | null = null,
): Card {
  return {
    id: `card-${closingDay}-${dueDay}-${rule}`,
    closingDay,
    dueDay,
    closingDayRule: rule,
    limitCents,
    paymentAccountId: null,
  };
}

let n = 0;
function tx(over: Partial<Tx>): Tx {
  n += 1;
  return {
    id: `tx-${n}`,
    kind: 'expense',
    status: 'posted',
    countBeforeReceived: false,
    invoicePinned: false,
    amountCents: 1000,
    occurredOn: '2026-11-05',
    description: null,
    categoryId: null,
    paymentMethod: 'credit',
    accountId: null,
    cardId: null,
    invoiceId: null,
    counterpartAccountId: null,
    counterpartCardId: null,
    seriesId: null,
    installmentNumber: null,
    installmentCount: null,
    recurrenceId: null,
    recurrenceDate: null,
    goalId: null,
    incomeExpected: false,
    source: 'manual',
    externalId: null,
    reviewState: 'ok',
    duplicateOf: null,
    merchantCnpj: null,
    deletedAt: null,
    ...over,
  };
}

const ctx = (today: string) => ({ today, newId: () => 'novo' });

describe('RN-12: em qual fatura cai uma compra (tabela do PRD)', () => {
  it.each([
    [3, 10, 'next', '2026-11-02', '2026-11-03', '2026-11-10', '2026-11'],
    [3, 10, 'next', '2026-11-03', '2026-12-03', '2026-12-10', '2026-12'],
    [3, 10, 'same', '2026-11-03', '2026-11-03', '2026-11-10', '2026-11'],
    [3, 10, 'next', '2026-11-04', '2026-12-03', '2026-12-10', '2026-12'],
    [25, 5, 'next', '2026-11-24', '2026-11-25', '2026-12-05', '2026-12'],
    [25, 5, 'next', '2026-11-25', '2026-12-25', '2027-01-05', '2027-01'],
    [31, 8, 'next', '2027-02-27', '2027-02-28', '2027-03-08', '2027-03'],
    [31, 8, 'next', '2027-02-28', '2027-03-31', '2027-04-08', '2027-04'],
    [31, 8, 'next', '2027-04-30', '2027-05-31', '2027-06-08', '2027-06'],
  ] as const)(
    'RN-12: F=%i V=%i regra %s, compra %s → fecha %s, vence %s, fatura %s',
    (f, v, rule, buy, closes, due, ref) => {
      const p = invoiceForPurchase(card(f, v, rule), buy);
      expect(p).toMatchObject({ closingDate: closes, dueDate: due, referenceMonth: ref });
      expect(p.id).toBe(invoiceId(card(f, v, rule).id, ref));
    },
  );
});

describe('§5.2: exemplos obrigatórios', () => {
  it.each([
    [3, 10, '2026-11-02', '2026-11', '2026-11-03', '2026-11-10'],
    [3, 10, '2026-11-03', '2026-12', '2026-12-03', '2026-12-10'],
    [28, 5, '2026-11-27', '2026-12', '2026-11-28', '2026-12-05'],
    [28, 5, '2026-11-28', '2027-01', '2026-12-28', '2027-01-05'],
    [31, 8, '2027-02-27', '2027-03', '2027-02-28', '2027-03-08'],
    [31, 8, '2027-02-28', '2027-04', '2027-03-31', '2027-04-08'],
  ] as const)('RN-11/RN-12: fecha %i vence %i, compra %s → %s', (f, v, buy, ref, closes, due) => {
    expect(invoiceForPurchase(card(f, v), buy)).toMatchObject({
      referenceMonth: ref,
      closingDate: closes,
      dueDate: due,
    });
  });
});

describe('períodos (RN-13)', () => {
  it('RN-13: regra next vai do fechamento anterior até a véspera do fechamento', () => {
    expect(invoicePeriod(card(3, 10), '2026-12')).toMatchObject({
      periodStart: '2026-11-03',
      periodEnd: '2026-12-02',
    });
  });

  it('RN-13: regra same vai do dia seguinte ao fechamento anterior até o fechamento', () => {
    expect(invoicePeriod(card(3, 10, 'same'), '2026-12')).toMatchObject({
      periodStart: '2026-11-04',
      periodEnd: '2026-12-03',
    });
  });

  it('datas manuais substituem as calculadas e ajustam o vizinho', () => {
    const c = card(3, 10);
    const overrides = [
      { referenceMonth: '2026-11', closingDate: '2026-11-05', dueDate: '2026-11-12' },
    ];
    expect(invoicePeriod(c, '2026-11', overrides)).toMatchObject({
      closingDate: '2026-11-05',
      dueDate: '2026-11-12',
    });
    expect(invoicePeriod(c, '2026-12', overrides).periodStart).toBe('2026-11-05');
    expect(invoiceForPurchase(c, '2026-11-04', overrides).referenceMonth).toBe('2026-11');
  });

  it('fatura aberta hoje e melhor dia de compra', () => {
    expect(currentOpenInvoice(card(3, 10), '2026-11-05').referenceMonth).toBe('2026-12');
    expect(bestPurchaseDay(card(3, 10))).toBe(3);
  });

  it('ensureInvoices devolve só os meses que faltam', () => {
    const c = card(3, 10);
    const existing = [invoicePeriod(c, '2026-12')];
    expect(ensureInvoices(c, '2026-11', '2027-01', existing).map((p) => p.referenceMonth)).toEqual([
      '2026-11',
      '2027-01',
    ]);
  });

  const cards = fc
    .record({
      f: fc.integer({ min: 1, max: 31 }),
      v: fc.integer({ min: 1, max: 31 }),
      rule: fc.constantFrom<'next' | 'same'>('next', 'same'),
    })
    .map(({ f, v, rule }) => card(f, v, rule));
  const dates = fc.integer({ min: 0, max: 3650 }).map((d) => addDays('2025-01-01', d));

  it('propriedade: invoiceForPurchase é monotônica', () => {
    fc.assert(
      fc.property(cards, dates, fc.integer({ min: 0, max: 120 }), (c, d, delta) => {
        const a = invoiceForPurchase(c, d).referenceMonth;
        const b = invoiceForPurchase(c, addDays(d, delta)).referenceMonth;
        expect(a <= b).toBe(true);
      }),
      RUNS,
    );
  });

  it('propriedade: toda data cai em exatamente um período e os períodos são contíguos', () => {
    fc.assert(
      fc.property(cards, dates, (c, d) => {
        const p = invoiceForPurchase(c, d);
        expect(d >= p.periodStart && d <= p.periodEnd).toBe(true);
        const next = invoicePeriod(c, addMonths(p.referenceMonth, 1));
        const prev = invoicePeriod(c, addMonths(p.referenceMonth, -1));
        expect(next.periodStart).toBe(addDays(p.periodEnd, 1));
        expect(prev.periodEnd).toBe(addDays(p.periodStart, -1));
        // F < V com fevereiro curto (ex.: F=28, V=29) dá vencimento no mesmo dia do fechamento (risco no HANDOFF)
        expect(p.dueDate >= p.closingDate).toBe(true);
        expect(monthOf(p.dueDate)).toBe(p.referenceMonth);
      }),
      RUNS,
    );
  });
});

describe('totais e status (RN-14, RN-15, RN-16)', () => {
  const c = card(3, 10);
  const p = invoicePeriod(c, '2026-12'); // período 03/11–02/12, vence 10/12
  const t = (charges: number, credits: number, payments: number): InvoiceTotals => ({
    chargesCents: charges,
    creditsCents: credits,
    paymentsCents: payments,
    balanceCents: charges - credits - payments,
  });

  it('RN-15: soma compras, estornos e pagamentos; ignora cancelados, excluídos e duplicados', () => {
    const items = [
      tx({ cardId: c.id, invoiceId: p.id, amountCents: 5000 }),
      tx({ cardId: c.id, invoiceId: p.id, amountCents: 700, kind: 'refund' }),
      tx({
        accountId: 'conta',
        counterpartCardId: c.id,
        invoiceId: p.id,
        amountCents: 1000,
        kind: 'transfer',
      }),
      tx({ cardId: c.id, invoiceId: p.id, amountCents: 999, status: 'cancelled' }),
      tx({ cardId: c.id, invoiceId: p.id, amountCents: 999, deletedAt: '2026-11-06T00:00:00Z' }),
      tx({ cardId: c.id, invoiceId: p.id, amountCents: 999, reviewState: 'merged' }),
      tx({ cardId: c.id, invoiceId: p.id, amountCents: 999, reviewState: 'suggested' }),
      tx({ cardId: c.id, invoiceId: 'outra', amountCents: 999 }),
    ];
    expect(invoiceTotals(p.id, items)).toEqual(t(5000, 700, 1000));
  });

  it.each([
    ['RN-14: paga depois do fechamento', t(5000, 0, 5000), '2026-12-05', 'paid'],
    ['RN-14: paga antecipadamente', t(5000, 0, 5000), '2026-11-20', 'paid'],
    ['RN-14: "sem valor a pagar" conta como paga', t(0, 0, 0), '2026-12-05', 'paid'],
    ['RN-14: saldo credor depois do fechamento é paga', t(100, 500, 0), '2026-12-05', 'paid'],
    ['RN-14: parcialmente paga até o vencimento', t(5000, 0, 1000), '2026-12-10', 'partial'],
    ['RN-14: vencida com pagamento parcial', t(5000, 0, 1000), '2026-12-11', 'overdue'],
    ['RN-14: vencida sem pagamento', t(5000, 0, 0), '2026-12-11', 'overdue'],
    ['RN-14: fechada no dia do fechamento (regra next)', t(5000, 0, 0), '2026-12-03', 'closed'],
    ['RN-14: aberta no último dia do período', t(5000, 0, 0), '2026-12-02', 'open'],
    ['RN-14: aberta sem itens', t(0, 0, 0), '2026-11-03', 'open'],
    ['RN-14: futura antes do período', t(5000, 0, 0), '2026-11-02', 'future'],
  ] as const)('%s', (_name, totals, today, status) => {
    expect(invoiceStatus(p, totals, today)).toBe(status);
  });

  it('RN-14: regra same só fecha no dia seguinte ao fechamento', () => {
    const same = invoicePeriod(card(3, 10, 'same'), '2026-12');
    expect(invoiceStatus(same, t(5000, 0, 0), '2026-12-03')).toBe('open');
    expect(invoiceStatus(same, t(5000, 0, 0), '2026-12-04')).toBe('closed');
  });

  it('RN-15: saldo credor vira estorno de sistema na fatura seguinte, idempotente', () => {
    const next = invoicePeriod(c, '2027-01');
    const totals = t(1000, 0, 1500);
    const credit = carryOverCredit(p, totals, next, ctx('2026-12-05'), 'cat-saldo-credor');
    expect(credit).toMatchObject({
      id: carryOverTxId(p.id),
      kind: 'refund',
      source: 'system',
      amountCents: 500,
      invoiceId: next.id,
      cardId: c.id,
      categoryId: 'cat-saldo-credor',
      description: CARRY_OVER_DESCRIPTION,
      invoicePinned: true,
      occurredOn: next.periodStart,
    });
    expect(carryOverCredit(p, totals, next, ctx('2026-12-05'), 'cat-saldo-credor')).toEqual(credit);
    expect(invoiceTotals(next.id, [{ ...(credit as Tx), deletedAt: null }]).creditsCents).toBe(500);
  });

  it('RN-15: sem saldo credor, ou fatura ainda aberta, não gera item', () => {
    const next = invoicePeriod(c, '2027-01');
    expect(carryOverCredit(p, t(1000, 0, 1000), next, ctx('2026-12-05'))).toBeNull();
    expect(carryOverCredit(p, t(1000, 0, 1500), next, ctx('2026-12-01'))).toBeNull();
    expect(carryOverCredit(p, t(1000, 0, 1500), next, ctx('2026-12-05'))?.categoryId).toBeNull();
  });

  it('limite disponível do cartão', () => {
    const limited = card(3, 10, 'next', 100000);
    const items = [
      tx({ cardId: limited.id, amountCents: 30000 }),
      tx({ cardId: limited.id, amountCents: 5000, kind: 'refund' }),
      tx({
        accountId: 'conta',
        counterpartCardId: limited.id,
        amountCents: 10000,
        kind: 'transfer',
      }),
      tx({ cardId: 'outro', amountCents: 99999 }),
      tx({ cardId: limited.id, amountCents: 99999, status: 'cancelled' }),
    ];
    expect(cardAvailableLimit(limited, items)).toBe(85000);
    expect(cardAvailableLimit(card(3, 10), items)).toBeNull();
  });
});

describe('RN-17/RN-18: mudança de fechamento recalcula só o que pode mudar', () => {
  const oldCard = card(3, 10);
  const newCard = { ...oldCard, closingDay: 10, dueDay: 17 };
  const inv = (m: string) => invoiceId(oldCard.id, m);

  it('RN-17: move itens de faturas abertas/futuras; não toca fechadas nem fixadas', () => {
    const items = [
      tx({ id: 'aberta', cardId: oldCard.id, occurredOn: '2026-11-05', invoiceId: inv('2026-12') }),
      tx({
        id: 'fechada',
        cardId: oldCard.id,
        occurredOn: '2026-10-20',
        invoiceId: inv('2026-11'),
      }),
      tx({
        id: 'fixada',
        cardId: oldCard.id,
        occurredOn: '2026-11-06',
        invoiceId: inv('2026-12'),
        invoicePinned: true,
      }),
      tx({
        id: 'parcela2',
        cardId: oldCard.id,
        occurredOn: '2026-11-05',
        invoiceId: inv('2027-01'),
        installmentNumber: 2,
      }),
      tx({ id: 'conta', accountId: 'c', occurredOn: '2026-11-05' }),
      tx({ id: 'pagamento', kind: 'transfer', cardId: oldCard.id, occurredOn: '2026-11-05' }),
      tx({ id: 'excluida', cardId: oldCard.id, occurredOn: '2026-11-05', deletedAt: 'x' }),
    ];
    const moves = reassignCardItems(oldCard, newCard, items, '2026-11-07');
    expect(moves.map((m) => m.txId)).toEqual(['aberta', 'parcela2']);
    expect(moves[0]).toMatchObject({ fromInvoiceId: inv('2026-12'), toReferenceMonth: '2026-11' });
    expect(moves[1]).toMatchObject({ toReferenceMonth: '2026-12' });
  });

  it('nada muda quando a fatura calculada é a mesma', () => {
    const item = tx({ cardId: oldCard.id, occurredOn: '2026-11-05', invoiceId: inv('2026-12') });
    expect(reassignCardItems(oldCard, { ...oldCard, dueDay: 12 }, [item], '2026-11-07')).toEqual(
      [],
    );
  });
});
