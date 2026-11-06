import { describe, expect, it } from 'vitest';
import type { MonthInput } from '../src/budget.ts';
import {
  monthlyNeedsHistory,
  type ReserveGoal,
  reserveProgress,
  suggestedReserveTarget,
} from '../src/reserve.ts';
import type { Category, Tx } from '../src/types.ts';

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
    categoryId: 'reserva-emergencia',
    paymentMethod: 'pix',
    accountId: 'bb',
    cardId: null,
    invoiceId: null,
    counterpartAccountId: null,
    counterpartCardId: null,
    seriesId: null,
    installmentNumber: null,
    installmentCount: null,
    recurrenceId: null,
    recurrenceDate: null,
    goalId: 'reserva',
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

const goal = (over: Partial<ReserveGoal> = {}): ReserveGoal => ({
  id: 'reserva',
  targetMode: 'manual',
  targetCents: 1800000,
  autoFactor: 6,
  autoLookbackMonths: 6,
  initialSavedCents: 0,
  ...over,
});

const history = [
  { month: '2026-08', needsCents: 290000, expenseCount: 10 },
  { month: '2026-09', needsCents: 310000, expenseCount: 12 },
  { month: '2026-10', needsCents: 300000, expenseCount: 8 },
];

describe('RN-52: meta sugerida', () => {
  it('RN-52: Necessidades 2.900/3.100/3.000 → média 3.000 → R$ 18.000,00', () => {
    expect(suggestedReserveTarget(history, 290000, { factor: 6, lookbackMonths: 6 })).toEqual({
      targetCents: 1800000,
      avgNeedsCents: 300000,
      basisMonths: ['2026-08', '2026-09', '2026-10'],
      provisional: false,
    });
  });

  it('RN-52: meses com menos de 5 despesas não contam; até N meses mais recentes; média meio para cima', () => {
    const h = [
      { month: '2026-07', needsCents: 999999, expenseCount: 20 },
      { month: '2026-08', needsCents: 100001, expenseCount: 6 },
      { month: '2026-09', needsCents: 100000, expenseCount: 6 },
      { month: '2026-10', needsCents: 5000, expenseCount: 4 },
    ];
    expect(suggestedReserveTarget(h, 0, { factor: 6, lookbackMonths: 2 })).toMatchObject({
      avgNeedsCents: 100001,
      basisMonths: ['2026-08', '2026-09'],
    });
  });

  it('RN-52: sem meses válidos → 6 × meta de Necessidades (provisória R$ 17.400,00 com Base de R$ 5.800,00)', () => {
    expect(suggestedReserveTarget([], 290000, { factor: 6, lookbackMonths: 6 })).toEqual({
      targetCents: 1740000,
      avgNeedsCents: 290000,
      basisMonths: [],
      provisional: true,
    });
  });

  it('RN-52: sem Base → sem sugestão', () => {
    expect(suggestedReserveTarget([], 0, { factor: 6, lookbackMonths: 6 })).toBeNull();
  });

  it('histórico de Necessidades a partir dos meses', () => {
    const categories: Category[] = [
      {
        id: 'mercado',
        parentId: null,
        kind: 'expense',
        bucket: 'needs',
        slug: 'mercado',
        feedsReserve: false,
        isSystem: false,
      },
    ];
    const input: MonthInput = {
      month: '2026-10',
      today: '2026-11-15',
      txs: [
        ...[1, 2, 3, 4, 5].map((d) =>
          tx({
            categoryId: 'mercado',
            goalId: null,
            occurredOn: `2026-10-0${d}`,
            amountCents: 1000,
          }),
        ),
        tx({ categoryId: 'mercado', goalId: null, occurredOn: '2026-10-09', status: 'cancelled' }),
      ],
      recurrences: [],
      cards: [],
      accounts: [],
      categories,
      invoiceMonthById: new Map(),
      attribution: 'invoice_due_month',
      includeRestrictedAccounts: true,
    };
    expect(monthlyNeedsHistory([input])).toEqual([
      { month: '2026-10', needsCents: 5000, expenseCount: 5 },
    ]);
  });
});

describe('RN-56: progresso', () => {
  it('RN-56: R$ 2.400 de R$ 18.000 → 13%', () => {
    const p = reserveProgress(
      goal(),
      [tx({ amountCents: 200000 }), tx({ amountCents: 40000 })],
      history,
      '2026-11-15',
    );
    expect(p).toMatchObject({
      savedCents: 240000,
      targetCents: 1800000,
      progressBp: 1333,
      monthsCovered: 0.8,
      achieved: false,
    });
    expect(Math.floor(p.progressBp / 100)).toBe(13);
  });

  it('RN-55/RN-36: saldo inicial soma e resgate subtrai; cartão, cancelado e futuro não contam', () => {
    const txs = [
      tx({ amountCents: 50000 }),
      tx({ kind: 'income', amountCents: 20000 }),
      tx({ amountCents: 99999, cardId: 'cartao', accountId: null }),
      tx({ amountCents: 99999, status: 'cancelled' }),
      tx({ amountCents: 99999, occurredOn: '2026-12-01' }),
      tx({ amountCents: 99999, goalId: 'outra' }),
    ];
    expect(
      reserveProgress(goal({ initialSavedCents: 100000 }), txs, history, '2026-11-15').savedCents,
    ).toBe(130000);
  });

  it('RN-56: resgates acima do guardado → 0% (a UI mostra o aviso)', () => {
    const p = reserveProgress(
      goal(),
      [tx({ kind: 'income', amountCents: 5000 })],
      history,
      '2026-11-15',
    );
    expect(p.savedCents).toBe(-5000);
    expect(p.progressBp).toBe(0);
    expect(p.monthsCovered).toBe(0);
  });

  it('RN-56: meta batida marca achieved e passa de 100% sem passar de 10000 bp', () => {
    const p = reserveProgress(
      goal({ targetCents: 100000 }),
      [tx({ amountCents: 150000 })],
      history,
      '2026-11-15',
    );
    expect(p).toMatchObject({ achieved: true, progressBp: 10000, etaMonths: 0 });
  });

  it('meta automática = fator × média de Necessidades', () => {
    expect(
      reserveProgress(goal({ targetMode: 'auto', targetCents: null }), [], history, '2026-11-15')
        .targetCents,
    ).toBe(1800000);
  });

  it('ETA pela média de aportes dos últimos 3 meses; nulo com menos de 2 meses de dados', () => {
    const three = [
      tx({ occurredOn: '2026-08-10', amountCents: 30000 }),
      tx({ occurredOn: '2026-09-10', amountCents: 30000 }),
      tx({ occurredOn: '2026-10-10', amountCents: 30000 }),
    ];
    expect(reserveProgress(goal(), three, history, '2026-11-15').etaMonths).toBe(57); // (1.800.000 − 90.000) / 30.000
    expect(
      reserveProgress(
        goal(),
        [tx({ occurredOn: '2026-10-10', amountCents: 30000 })],
        history,
        '2026-11-15',
      ).etaMonths,
    ).toBeNull();
    expect(reserveProgress(goal(), [], history, '2026-11-15').etaMonths).toBeNull();
  });
});
