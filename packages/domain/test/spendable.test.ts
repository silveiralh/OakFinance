import { describe, expect, it } from 'vitest';
import type { BudgetConfig, MonthInput } from '../src/budget.ts';
import { invoiceId } from '../src/ids.ts';
import { materializeOccurrence, type Recurrence } from '../src/recurrence.ts';
import {
  DEFAULT_SPENDABLE_CONFIG,
  daysLeftInMonth,
  monthStatus,
  restrictedBalances,
  type SpendableConfig,
  spendableThisMonth,
} from '../src/spendable.ts';
import type { Account, Card, Category, Tx } from '../src/types.ts';

const cat = (
  id: string,
  bucket: Category['bucket'],
  kind: Category['kind'] = 'expense',
): Category => ({
  id,
  parentId: null,
  kind,
  bucket,
  slug: id,
  feedsReserve: bucket === 'savings',
  isSystem: false,
});
const categories = [
  cat('mercado', 'needs'),
  cat('moradia', 'needs'),
  cat('contas-da-casa', 'needs'),
  cat('lazer', 'wants'),
  cat('reserva-emergencia', 'savings'),
  cat('salario', 'income', 'income'),
  cat('renda-extra', 'income', 'income'),
  cat('beneficios', 'income', 'income'),
];
const accounts: Account[] = [
  {
    id: 'bb',
    type: 'checking',
    isRestricted: false,
    includeInSpendable: true,
    initialBalanceCents: 0,
    initialBalanceOn: '2026-01-01',
  },
  {
    id: 'vr',
    type: 'meal_voucher',
    isRestricted: true,
    includeInSpendable: true,
    initialBalanceCents: 1000,
    initialBalanceOn: '2026-01-01',
  },
];
const cardA: Card = {
  id: 'cartao-a',
  closingDay: 3,
  dueDay: 10,
  closingDayRule: 'next',
  limitCents: null,
  paymentAccountId: 'bb',
};
const NOV = invoiceId(cardA.id, '2026-11');
const DEC = invoiceId(cardA.id, '2026-12');
const budget: BudgetConfig = {
  pctBp: { needs: 5000, wants: 3000, savings: 2000 },
  alertThresholdsBp: [8000, 10000],
};

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
    categoryId: 'mercado',
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

function recurrence(over: Partial<Recurrence>): Recurrence {
  return {
    id: 'rec',
    kind: 'expense',
    description: 'Conta',
    amountCents: 1000,
    isVariableAmount: false,
    categoryId: 'contas-da-casa',
    accountId: 'bb',
    cardId: null,
    paymentMethod: 'pix',
    isFixedIncome: false,
    autoPost: false,
    remind: true,
    pausedAt: null,
    deletedAt: null,
    frequency: 'monthly',
    intervalCount: 1,
    dayOfMonth: 20,
    startOn: '2026-01-01',
    ...over,
  };
}

const salario = recurrence({
  id: 'rec-salario',
  kind: 'income',
  description: 'Salário',
  isFixedIncome: true,
  categoryId: 'salario',
  amountCents: 500000,
  dayOfMonth: 5,
  paymentMethod: 'transfer',
});
const luz = recurrence({
  id: 'rec-luz',
  isVariableAmount: true,
  amountCents: 18000,
  dayOfMonth: 20,
});
const internet = recurrence({ id: 'rec-internet', amountCents: 10000, dayOfMonth: 25 });

/** Caso de referência da RN-47 (modo caixa, hoje 15/11/2026, Cartão A F=3/V=10). */
function reference(): Tx[] {
  return [
    { ...materializeOccurrence(salario, '2026-11-05', null), deletedAt: null },
    tx({ kind: 'income', categoryId: 'renda-extra', amountCents: 80000, occurredOn: '2026-11-10' }),
    tx({
      kind: 'income',
      categoryId: 'renda-extra',
      amountCents: 30000,
      occurredOn: '2026-11-25',
      incomeExpected: true,
      id: 'freela-25',
    }),
    tx({ categoryId: 'reserva-emergencia', amountCents: 20000, occurredOn: '2026-11-06' }),
    tx({
      categoryId: 'mercado',
      amountCents: 45000,
      occurredOn: '2026-11-08',
      paymentMethod: 'debit',
    }),
    tx({ categoryId: 'moradia', amountCents: 150000, occurredOn: '2026-11-10' }),
    tx({
      cardId: cardA.id,
      accountId: null,
      invoiceId: NOV,
      paymentMethod: 'credit',
      amountCents: 120000,
      occurredOn: '2026-10-20',
    }),
    tx({
      kind: 'transfer',
      categoryId: null,
      counterpartCardId: cardA.id,
      invoiceId: NOV,
      amountCents: 120000,
      occurredOn: '2026-11-10',
      paymentMethod: 'transfer',
    }),
  ];
}

function input(txs: Tx[], over: Partial<MonthInput> = {}): MonthInput {
  return {
    month: '2026-11',
    today: '2026-11-15',
    txs,
    recurrences: [salario, luz, internet],
    cards: [cardA],
    accounts,
    categories,
    invoiceMonthById: new Map([
      [NOV, '2026-11'],
      [DEC, '2026-12'],
    ]),
    attribution: 'invoice_due_month',
    includeRestrictedAccounts: true,
    ...over,
  };
}

const run = (txs: Tx[], config: Partial<SpendableConfig> = {}, over: Partial<MonthInput> = {}) =>
  spendableThisMonth(input(txs, over), budget, { ...DEFAULT_SPENDABLE_CONFIG, ...config });

describe('RN-47: caso de referência', () => {
  it('RN-47: Disponível R$ 1.210,00, R$ 75,62 por dia e "No ritmo do mês"', () => {
    const r = run(reference());
    expect(r.income.totalCents).toBe(580000);
    expect(r.spentCents).toBe(335000);
    expect(r.upcoming).toEqual({
      cardCents: 0,
      recurringCents: 28000,
      scheduledCents: 0,
      totalCents: 28000,
    });
    expect(r.savingsDoneCents).toBe(20000);
    expect(r.savingsReserveCents).toBe(96000);
    expect(r.availableCents).toBe(121000);
    expect(r.daysLeft).toBe(16);
    expect(r.perDayCents).toBe(7562);
    expect(r.status).toBe('on_track');
  });
});

describe('§5.6: exemplo obrigatório', () => {
  it('Disponível 134000, 16 dias, 8375 por dia, on_track', () => {
    const aluguel = recurrence({
      id: 'rec-aluguel',
      categoryId: 'moradia',
      amountCents: 150000,
      dayOfMonth: 20,
    });
    const txs = [
      tx({
        kind: 'income',
        categoryId: 'renda-extra',
        amountCents: 80000,
        occurredOn: '2026-11-03',
      }),
      tx({ categoryId: 'reserva-emergencia', amountCents: 30000, occurredOn: '2026-11-04' }),
      tx({ categoryId: 'mercado', amountCents: 90000, occurredOn: '2026-11-12' }),
      tx({
        cardId: cardA.id,
        accountId: null,
        invoiceId: NOV,
        paymentMethod: 'credit',
        amountCents: 90000,
        occurredOn: '2026-10-15',
      }),
    ];
    const r = run(txs, {}, { recurrences: [salario, aluguel] });
    expect(r.upcoming).toMatchObject({
      cardCents: 90000,
      recurringCents: 150000,
      totalCents: 240000,
    });
    expect(r.savingsReserveCents).toBe(86000);
    expect(r).toMatchObject({
      availableCents: 134000,
      daysLeft: 16,
      perDayCents: 8375,
      status: 'on_track',
    });
  });
});

describe('US-30: variações do painel', () => {
  it('US-30: débito de R$ 50,00 em 15/11 → R$ 1.160,00', () => {
    expect(
      run([
        ...reference(),
        tx({ amountCents: 5000, occurredOn: '2026-11-15', paymentMethod: 'debit' }),
      ]).availableCents,
    ).toBe(116000);
  });

  it('US-30: compra de R$ 150,00 no cartão em 15/11 não muda o valor (caixa) e soma na linha futura', () => {
    const r = run([
      ...reference(),
      tx({
        cardId: cardA.id,
        accountId: null,
        invoiceId: DEC,
        paymentMethod: 'credit',
        amountCents: 15000,
        occurredOn: '2026-11-15',
      }),
    ]);
    expect(r.availableCents).toBe(121000);
    expect(r.futureCardCents).toBe(15000);
  });

  it('US-30: ligar "Contar antes de receber" no freela de R$ 300,00 → Base 6.100, aporte 1.020, +R$ 240,00', () => {
    const txs = reference().map((t) =>
      t.id === 'freela-25' ? { ...t, countBeforeReceived: true } : t,
    );
    const r = run(txs);
    expect(r.income.totalCents).toBe(610000);
    expect(r.savingsReserveCents).toBe(102000);
    expect(r.availableCents).toBe(145000);
    expect(run(txs, { includeExpectedIncome: false }).availableCents).toBe(121000);
  });

  it('US-30: mês sem renda → no_income', () => {
    const r = run([tx({ amountCents: 5000 })], {}, { recurrences: [] });
    expect(r.status).toBe('no_income');
    expect(r.spentCents).toBe(5000);
    expect(r.perDayCents).toBe(0);
  });

  it('RN-48/RN-50: negativo → over sem valor por dia; zero → attention', () => {
    const over = run([...reference(), tx({ amountCents: 133000, occurredOn: '2026-11-14' })]);
    expect(over.availableCents).toBe(-12000);
    expect(over.status).toBe('over');
    expect(over.perDayCents).toBe(0);
    const zero = run([...reference(), tx({ amountCents: 121000, occurredOn: '2026-11-14' })]);
    expect(zero.availableCents).toBe(0);
    expect(zero.status).toBe('attention');
    expect(zero.perDayCents).toBe(0);
  });

  it('RN-48: virada do mês calcula dezembro sem carregar novembro', () => {
    const r = run(reference(), {}, { month: '2026-12', today: '2026-12-01' });
    expect(r.income.totalCents).toBe(500000);
    expect(r.spentCents).toBe(0);
    expect(r.daysLeft).toBe(31);
  });
});

describe('US-34: ajustes do cálculo', () => {
  it('US-34: modo competência → R$ 2.260,00 e a linha futura some', () => {
    const txs = [
      ...reference(),
      tx({
        cardId: cardA.id,
        accountId: null,
        invoiceId: DEC,
        paymentMethod: 'credit',
        amountCents: 15000,
        occurredOn: '2026-11-15',
      }),
    ];
    const r = run(txs, { cardAttribution: 'purchase_month' });
    expect(r.availableCents).toBe(226000);
    expect(r.futureCardCents).toBe(0);
  });

  it('US-34: sem descontar a poupança → R$ 2.170,00', () => {
    expect(run(reference(), { savingsMode: 'none' }).availableCents).toBe(217000);
  });

  it('US-34: sem descontar o que vence → não subtrai CP', () => {
    expect(run(reference(), { includeUpcoming: false }).availableCents).toBe(121000 + 28000);
  });

  it('US-34: desligar VR/VA tira R$ 600,00 da Base e R$ 400,00 dos gastos', () => {
    const vr = recurrence({
      id: 'rec-vr',
      kind: 'income',
      isFixedIncome: true,
      categoryId: 'beneficios',
      accountId: 'vr',
      amountCents: 60000,
      dayOfMonth: 1,
    });
    const txs = [
      ...reference(),
      tx({
        accountId: 'vr',
        paymentMethod: 'meal_voucher',
        amountCents: 40000,
        occurredOn: '2026-11-12',
      }),
    ];
    const on = run(txs, {}, { recurrences: [salario, luz, internet, vr] });
    const off = run(
      txs,
      { includeRestrictedAccounts: false },
      { recurrences: [salario, luz, internet, vr] },
    );
    expect(on.income.totalCents - off.income.totalCents).toBe(60000);
    expect(on.spentCents - off.spentCents).toBe(40000);
  });
});

describe('detalhes', () => {
  it('RN-36: resgate da reserva soma no painel e fica fora da Base', () => {
    const r = run([
      ...reference(),
      tx({
        kind: 'income',
        goalId: 'reserva',
        categoryId: 'renda-extra',
        amountCents: 10000,
        occurredOn: '2026-11-14',
      }),
    ]);
    expect(r.withdrawalsCents).toBe(10000);
    expect(r.income.totalCents).toBe(580000);
    expect(r.availableCents).toBe(131000);
  });

  it('despesa agendada em meio imediato entra em "vai sair"; estorno desconta', () => {
    const r = run([
      ...reference(),
      tx({ amountCents: 7000, occurredOn: '2026-11-28' }),
      tx({
        kind: 'refund',
        cardId: cardA.id,
        accountId: null,
        invoiceId: NOV,
        amountCents: 1000,
        occurredOn: '2026-11-01',
      }),
    ]);
    expect(r.upcoming.scheduledCents).toBe(7000);
  });

  it('status e dias restantes', () => {
    expect(monthStatus(116000, 580000)).toBe('on_track');
    expect(monthStatus(115999, 580000)).toBe('attention');
    expect(daysLeftInMonth('2026-11', '2026-11-30')).toBe(1);
    expect(daysLeftInMonth('2026-12', '2026-11-15')).toBe(31);
    expect(daysLeftInMonth('2026-10', '2026-11-15')).toBe(0);
  });

  it('saldo das contas restritas', () => {
    const txs = [
      tx({
        kind: 'income',
        accountId: 'vr',
        categoryId: 'beneficios',
        amountCents: 60000,
        occurredOn: '2026-11-01',
      }),
      tx({ accountId: 'vr', amountCents: 40000, occurredOn: '2026-11-12' }),
      tx({ accountId: 'vr', amountCents: 999, occurredOn: '2026-12-01' }),
      tx({ kind: 'transfer', accountId: 'bb', counterpartAccountId: 'vr', amountCents: 500 }),
    ];
    expect(restrictedBalances(accounts, txs, '2026-11-30')).toEqual([
      { accountId: 'vr', balanceCents: 1000 + 60000 - 40000 + 500 },
    ]);
  });

  it('RN-51: 5.000 lançamentos recalculam em menos de 200 ms', () => {
    const many: Tx[] = [];
    for (let i = 0; i < 5000; i++) {
      const day = String((i % 28) + 1).padStart(2, '0');
      many.push(
        i % 3 === 0
          ? tx({
              cardId: cardA.id,
              accountId: null,
              invoiceId: i % 2 ? NOV : DEC,
              paymentMethod: 'credit',
              amountCents: 100 + i,
              occurredOn: `2026-11-${day}`,
            })
          : tx({
              amountCents: 100 + i,
              occurredOn: `2026-11-${day}`,
              categoryId: i % 2 ? 'mercado' : 'lazer',
            }),
      );
    }
    const txs = [...reference(), ...many];
    run(txs); // aquecimento do JIT
    const start = performance.now();
    run(txs);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
