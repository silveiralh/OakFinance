import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/errors.ts';
import { installmentTxId, invoiceId } from '../src/ids.ts';
import {
  buildInstallments,
  cancelRemainingInstallments,
  type InstallmentPlanInput,
  installmentAmounts,
  rescheduleInstallments,
  totalFromInstallment,
} from '../src/installments.ts';
import type { InvoiceStatus } from '../src/invoices.ts';
import type { Card, Tx } from '../src/types.ts';

const cardA: Card = {
  id: 'cartao-a',
  closingDay: 3,
  dueDay: 10,
  closingDayRule: 'next',
  limitCents: null,
  paymentAccountId: null,
};

function plan(over: Partial<InstallmentPlanInput> = {}): InstallmentPlanInput {
  return {
    seriesId: 'serie-1',
    cardId: cardA.id,
    accountId: null,
    purchaseDate: '2026-11-05',
    totalCents: 100000,
    count: 10,
    description: 'Geladeira',
    categoryId: null,
    ...over,
  };
}

function asTx(d: ReturnType<typeof buildInstallments>[number], over: Partial<Tx> = {}): Tx {
  return {
    id: d.id,
    kind: 'expense',
    status: 'posted',
    countBeforeReceived: false,
    invoicePinned: false,
    amountCents: d.amountCents,
    occurredOn: d.occurredOn,
    description: null,
    categoryId: null,
    paymentMethod: 'credit',
    accountId: null,
    cardId: cardA.id,
    invoiceId: d.invoiceId,
    counterpartAccountId: null,
    counterpartCardId: null,
    seriesId: 'serie-1',
    installmentNumber: d.installmentNumber,
    installmentCount: d.installmentCount,
    recurrenceId: null,
    recurrenceDate: null,
    goalId: null,
    incomeExpected: false,
    source: 'installment',
    externalId: null,
    reviewState: 'ok',
    duplicateOf: null,
    merchantCnpj: null,
    deletedAt: null,
    ...over,
  };
}

const inv = (m: string) => invoiceId(cardA.id, m);

describe('RN-20/RN-21: valores das parcelas', () => {
  it.each([
    ['R$ 100,00 em 3×', 10000, 3, [3334, 3333, 3333]],
    ['R$ 1.000,00 em 10×', 100000, 10, new Array(10).fill(10000)],
    ['R$ 99,99 em 2×', 9999, 2, [5000, 4999]],
    ['R$ 0,10 em 3×', 10, 3, [4, 3, 3]],
  ] as const)('RN-21: %s', (_name, total, count, expected) => {
    expect(installmentAmounts(total, count)).toEqual(expected);
  });

  it('RN-20/RN-21: parcela de R$ 49,90 em 10× → total R$ 499,00 e 10 × 49,90', () => {
    const total = totalFromInstallment(4990, 10);
    expect(total).toBe(49900);
    expect(installmentAmounts(total, 10)).toEqual(new Array(10).fill(4990));
  });

  it('primeira parcela informada pelo banco', () => {
    expect(installmentAmounts(10000, 3, 3500)).toEqual([3500, 3250, 3250]);
    expect(() => installmentAmounts(10000, 3, 9999)).toThrowError(DomainError);
  });

  it('RN-20: n entre 2 e 48 e total mínimo de n centavos', () => {
    expect(() => installmentAmounts(10000, 1)).toThrowError(DomainError);
    expect(() => installmentAmounts(10000, 49)).toThrowError(DomainError);
    expect(() => installmentAmounts(2, 3)).toThrowError(DomainError);
  });
});

describe('RN-22: distribuição nas faturas', () => {
  it('RN-22: 10× em 05/11/2026 no Cartão A → faturas dez/2026 a set/2027', () => {
    const drafts = buildInstallments(plan(), cardA);
    expect(drafts.map((d) => d.invoiceReferenceMonth)).toEqual([
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
      '2027-07',
      '2027-08',
      '2027-09',
    ]);
    expect(drafts.every((d) => d.occurredOn === '2026-11-05')).toBe(true);
    expect(drafts[0]).toMatchObject({
      id: installmentTxId('serie-1', 1),
      invoiceId: inv('2026-12'),
      installmentCount: 10,
    });
  });

  it('RN-22: R$ 100,00 em 3× em 02/11/2026 → nov/2026 (33,34), dez/2026 e jan/2027 (33,33)', () => {
    const drafts = buildInstallments(
      plan({ purchaseDate: '2026-11-02', totalCents: 10000, count: 3 }),
      cardA,
    );
    expect(drafts.map((d) => [d.invoiceReferenceMonth, d.amountCents])).toEqual([
      ['2026-11', 3334],
      ['2026-12', 3333],
      ['2027-01', 3333],
    ]);
  });

  it('compra já em andamento gera só de startInstallment em diante', () => {
    const drafts = buildInstallments(plan({ startInstallment: 4 }), cardA);
    expect(drafts.map((d) => d.installmentNumber)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(drafts[0]?.invoiceReferenceMonth).toBe('2027-03');
    expect(() => buildInstallments(plan({ startInstallment: 11 }), cardA)).toThrowError(
      DomainError,
    );
  });

  it('carnê na conta: vencimentos mensais no dia do primeiro, sem fatura', () => {
    const drafts = buildInstallments(
      plan({
        cardId: null,
        accountId: 'conta',
        firstDueOn: '2027-01-31',
        totalCents: 30000,
        count: 3,
      }),
      null,
    );
    expect(drafts.map((d) => d.occurredOn)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(drafts.every((d) => d.invoiceId === null)).toBe(true);
    expect(() => buildInstallments(plan({ cardId: null, accountId: 'conta' }), null)).toThrowError(
      DomainError,
    );
  });

  it('exige exatamente um entre cartão e conta, e o cartão certo', () => {
    expect(() => buildInstallments(plan({ accountId: 'conta' }), cardA)).toThrowError(DomainError);
    expect(() => buildInstallments(plan(), null)).toThrowError(DomainError);
  });
});

describe('RN-24/RN-25: editar e cancelar a série', () => {
  const threeX = buildInstallments(
    plan({ purchaseDate: '2026-11-02', totalCents: 10000, count: 3 }),
    cardA,
  ).map((d) => asTx(d));
  const allOpen = (): InvoiceStatus => 'open';

  it('RN-24: de 3× para 2× sem parcela paga → [5000, 5000] e a 3ª recebe soft delete', () => {
    const result = rescheduleInstallments(
      threeX,
      plan({ purchaseDate: '2026-11-02', totalCents: 10000, count: 2 }),
      cardA,
      allOpen,
    );
    expect(result.upsert.map((d) => d.amountCents)).toEqual([5000, 5000]);
    expect(result.softDelete).toEqual([installmentTxId('serie-1', 3)]);
  });

  it('US-21: mudar o total de R$ 1.000,00 para R$ 1.200,00 regenera 10 × R$ 120,00 com o mesmo seriesId', () => {
    const tenX = buildInstallments(plan(), cardA).map((d) => asTx(d));
    const result = rescheduleInstallments(tenX, plan({ totalCents: 120000 }), cardA, allOpen);
    expect(result.upsert.map((d) => d.amountCents)).toEqual(new Array(10).fill(12000));
    expect(result.upsert.map((d) => d.id)).toEqual(tenX.map((t) => t.id));
    expect(result.softDelete).toEqual([]);
  });

  it('RN-24: com a 1ª parcela em fatura paga → INSTALLMENTS_LOCKED', () => {
    const statusOf = (id: string): InvoiceStatus => (id === inv('2026-11') ? 'paid' : 'open');
    expect(() =>
      rescheduleInstallments(threeX, plan({ count: 2, totalCents: 10000 }), cardA, statusOf),
    ).toThrowError(expect.objectContaining({ code: 'INSTALLMENTS_LOCKED' }));
    const partial = (id: string): InvoiceStatus => (id === inv('2026-12') ? 'partial' : 'open');
    expect(() =>
      rescheduleInstallments(threeX, plan({ count: 2, totalCents: 10000 }), cardA, partial),
    ).toThrowError(DomainError);
  });

  it('US-21: em 15/01/2027, cancelar restantes cancela fev..set e mantém dez (paga) e jan (fechada)', () => {
    const tenX = buildInstallments(plan(), cardA).map((d) => asTx(d));
    const statuses: Record<string, InvoiceStatus> = {
      [inv('2026-12')]: 'paid',
      [inv('2027-01')]: 'closed',
      [inv('2027-02')]: 'open',
    };
    const statusOf = (id: string): InvoiceStatus => statuses[id] ?? 'future';
    const cancelled = cancelRemainingInstallments(tenX, statusOf);
    expect(cancelled).toEqual(tenX.slice(2).map((t) => t.id));
    expect(cancelled).toHaveLength(8);
  });

  it('RN-25: ignora excluídas, já canceladas e parcelas sem fatura', () => {
    const items = [
      asTx(buildInstallments(plan(), cardA)[0] as never, { deletedAt: 'x' }),
      asTx(buildInstallments(plan(), cardA)[1] as never, { status: 'cancelled' }),
      asTx(buildInstallments(plan(), cardA)[2] as never, { invoiceId: null }),
    ];
    expect(cancelRemainingInstallments(items, () => 'open')).toEqual([]);
  });
});
