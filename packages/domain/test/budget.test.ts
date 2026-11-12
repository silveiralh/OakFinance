import { describe, expect, it } from 'vitest';
import {
  type BudgetConfig,
  bucketBudget,
  budgetMonthOf,
  categoryBudgets,
  categoryConsumption,
  isPredicted,
  type MonthInput,
  monthlyIncome,
  resolveBudgetConfig,
  thresholdCrossings,
  unbucketed,
} from '../src/budget.ts';
import { materializeOccurrence, type Recurrence } from '../src/recurrence.ts';
import type { Account, Card, Category, Tx } from '../src/types.ts';

const cat = (
  id: string,
  bucket: Category['bucket'],
  kind: Category['kind'] = 'expense',
  slug: string | null = id,
): Category => ({
  id,
  parentId: null,
  kind,
  bucket,
  slug,
  feedsReserve: bucket === 'savings',
  isSystem: bucket === 'none',
});
const categories = [
  cat('mercado', 'needs'),
  cat('lazer', 'wants'),
  cat('reserva-emergencia', 'savings'),
  cat('a-classificar', 'none'),
  cat('salario', 'income', 'income'),
  cat('beneficios', 'income', 'income'),
  cat('renda-extra', 'income', 'income'),
  cat('transferencia-entre-contas', 'transfer', 'transfer'),
];
const accounts: Account[] = [
  {
    id: 'conta',
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
    initialBalanceCents: 0,
    initialBalanceOn: '2026-01-01',
  },
];
const cardA: Card = {
  id: 'cartao-a',
  closingDay: 3,
  dueDay: 10,
  closingDayRule: 'next',
  limitCents: null,
  paymentAccountId: null,
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
    accountId: 'conta',
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

function salary(over: Partial<Recurrence> = {}): Recurrence {
  return {
    id: 'rec-salario',
    kind: 'income',
    description: 'Salário',
    amountCents: 500000,
    isVariableAmount: false,
    categoryId: 'salario',
    accountId: 'conta',
    cardId: null,
    paymentMethod: 'transfer',
    isFixedIncome: true,
    autoPost: false,
    remind: true,
    pausedAt: null,
    deletedAt: null,
    frequency: 'monthly',
    intervalCount: 1,
    dayOfMonth: 5,
    startOn: '2026-01-05',
    ...over,
  };
}

function input(over: Partial<MonthInput> = {}): MonthInput {
  return {
    month: '2026-11',
    today: '2026-11-15',
    txs: [],
    recurrences: [],
    cards: [cardA],
    accounts,
    categories,
    invoiceMonthById: new Map(),
    attribution: 'invoice_due_month',
    includeRestrictedAccounts: true,
    ...over,
  };
}

const config: BudgetConfig = {
  pctBp: { needs: 5000, wants: 3000, savings: 2000 },
  alertThresholdsBp: [8000, 10000],
};

describe('budgetMonthOf (RN-46)', () => {
  const months = new Map([['fatura-dez', '2026-12']]);
  it('RN-46: meio imediato conta no mês da data', () => {
    expect(budgetMonthOf(tx({ occurredOn: '2026-11-30' }), months, 'invoice_due_month')).toBe(
      '2026-11',
    );
  });
  it('RN-46: caixa (padrão) conta no mês do vencimento da fatura', () => {
    expect(
      budgetMonthOf(tx({ cardId: cardA.id, invoiceId: 'fatura-dez' }), months, 'invoice_due_month'),
    ).toBe('2026-12');
    expect(
      budgetMonthOf(tx({ cardId: cardA.id, invoiceId: 'sem-mapa' }), months, 'invoice_due_month'),
    ).toBe('2026-11');
  });
  it('RN-46: competência conta no mês da compra, parcela k em +k−1', () => {
    expect(
      budgetMonthOf(tx({ cardId: cardA.id, invoiceId: 'fatura-dez' }), months, 'purchase_month'),
    ).toBe('2026-11');
    expect(
      budgetMonthOf(
        tx({ cardId: cardA.id, invoiceId: 'x', installmentNumber: 3 }),
        months,
        'purchase_month',
      ),
    ).toBe('2027-01');
  });
});

describe('monthlyIncome: Base(M) (RN-32, RN-33, RN-35, RN-36, RN-38)', () => {
  it('RN-32: receita fixa conta pelo previsto antes de cair', () => {
    expect(monthlyIncome(input({ recurrences: [salary()] }))).toEqual({
      fixedCents: 500000,
      variableReceivedCents: 0,
      variableExpectedCents: 0,
      totalCents: 500000,
    });
  });

  it('RN-32: valor real confirmado substitui o previsto; "não recebi" (cancelada) sai da Base', () => {
    const real = {
      ...materializeOccurrence(salary(), '2026-11-05', null, [], 480000),
      deletedAt: null,
    };
    expect(monthlyIncome(input({ recurrences: [salary()], txs: [real] })).fixedCents).toBe(480000);
    const skipped = { ...real, status: 'cancelled' as const };
    expect(monthlyIncome(input({ recurrences: [salary()], txs: [skipped] })).fixedCents).toBe(0);
  });

  it('RN-32 (T-133, UX2B-001): receita manual não ligada à receita fixa soma à parte — comportamento atual, aguarda o dono', () => {
    // A RN-27/RN-32 só tiram o previsto da Base quando a ocorrência é confirmada, pulada ou conciliada; um
    // salário lançado à mão (sem `recurrenceId`) conta como receita variável e o previsto continua. A auditoria
    // de 12/11 viu a renda em dobro por isso. Se o dono decidir ligar (ou sugerir ligar) o lançamento manual à
    // receita fixa, este teste muda junto (HANDOFF §4, D-107).
    const manual = tx({
      id: 'salario-manual',
      kind: 'income',
      amountCents: 500000,
      occurredOn: '2026-11-05',
      categoryId: 'salario',
      accountId: 'conta',
      cardId: null,
      invoiceId: null,
      paymentMethod: 'transfer',
    });
    const income = monthlyIncome(input({ recurrences: [salary()], txs: [manual] }));
    expect(income.fixedCents).toBe(500000);
    expect(income.variableReceivedCents).toBe(500000);
    expect(income.totalCents).toBe(1000000);
  });

  it('RN-33: Recebida conta, A receber não conta, Prevista conta só com o switch ligado', () => {
    const txs = [
      tx({ kind: 'income', categoryId: 'renda-extra', amountCents: 30000 }),
      tx({ kind: 'income', categoryId: 'renda-extra', amountCents: 20000, incomeExpected: true }),
      tx({
        kind: 'income',
        categoryId: 'renda-extra',
        amountCents: 10000,
        incomeExpected: true,
        countBeforeReceived: true,
      }),
    ];
    expect(monthlyIncome(input({ txs }))).toEqual({
      fixedCents: 0,
      variableReceivedCents: 30000,
      variableExpectedCents: 10000,
      totalCents: 40000,
    });
    expect(monthlyIncome(input({ txs }), { includeExpected: false }).totalCents).toBe(30000);
  });

  it('RN-36/RN-38: resgate da reserva, transferência, cancelada e outro mês não entram', () => {
    const txs = [
      tx({ kind: 'income', categoryId: 'renda-extra', goalId: 'reserva', amountCents: 99 }),
      tx({ kind: 'transfer', counterpartAccountId: 'vr', amountCents: 99 }),
      tx({ kind: 'income', categoryId: 'renda-extra', status: 'cancelled', amountCents: 99 }),
      tx({ kind: 'income', categoryId: 'renda-extra', occurredOn: '2026-12-01', amountCents: 99 }),
    ];
    expect(monthlyIncome(input({ txs })).totalCents).toBe(0);
  });

  it('RN-35: com VR/VA desligado, saem a receita de benefício e as despesas pagas com VR', () => {
    const vr = salary({
      id: 'rec-vr',
      categoryId: 'beneficios',
      accountId: 'vr',
      amountCents: 80000,
    });
    const txs = [tx({ accountId: 'vr', paymentMethod: 'meal_voucher', amountCents: 5000 })];
    expect(monthlyIncome(input({ recurrences: [salary(), vr] })).totalCents).toBe(580000);
    const off = input({ recurrences: [salary(), vr], txs, includeRestrictedAccounts: false });
    expect(monthlyIncome(off).totalCents).toBe(500000);
    expect(bucketBudget(off, config, 500000).needs.spentCents).toBe(0);
    expect(bucketBudget(input({ txs }), config, 580000).needs.spentCents).toBe(5000);
  });
});

describe('50/30/20 (RN-44, RN-45, RN-41, RN-04)', () => {
  it('RN-44: meta de R$ 333,33 × 50% = R$ 166,67 (meio para cima)', () => {
    expect(bucketBudget(input(), config, 33333).needs.targetCents).toBe(16667);
  });

  it('RN-45: separa "já foi" e "vai sair", desconta estornos, inclui projetadas', () => {
    const aluguel: Recurrence = {
      ...salary({
        id: 'rec-aluguel',
        kind: 'expense',
        isFixedIncome: false,
        categoryId: 'mercado',
        amountCents: 40000,
        dayOfMonth: 20,
      }),
    };
    const txs = [
      tx({ amountCents: 10000 }),
      tx({ amountCents: 2000, kind: 'refund' }),
      tx({ amountCents: 7000, occurredOn: '2026-11-25' }),
      tx({ categoryId: 'lazer', amountCents: 50000 }),
      tx({ categoryId: 'reserva-emergencia', amountCents: 30000 }),
    ];
    const result = bucketBudget(input({ txs, recurrences: [aluguel] }), config, 200000);
    expect(result.needs).toMatchObject({
      targetCents: 100000,
      spentCents: 8000,
      committedCents: 47000,
      remainingCents: 45000,
      usageBp: 5500,
      level: 'ok',
    });
    expect(result.wants).toMatchObject({
      targetCents: 60000,
      spentCents: 50000,
      usageBp: 8333,
      level: 'warning',
    });
    expect(result.savings).toMatchObject({ targetCents: 40000, spentCents: 30000, level: 'ok' });
  });

  it('RN-45: categoryConsumption separa "já foi" e "vai sair" por categoria, com a mesma soma das faixas', () => {
    const txs = [
      tx({ amountCents: 10000 }),
      tx({ amountCents: 2000, kind: 'refund' }),
      tx({ amountCents: 7000, occurredOn: '2026-11-25' }),
      tx({ categoryId: 'lazer', amountCents: 50000 }),
      tx({ categoryId: null, amountCents: 900 }),
    ];
    const byCategory = categoryConsumption(input({ txs }));
    expect(byCategory.get('mercado')).toEqual({ spentCents: 8000, committedCents: 7000 });
    expect(byCategory.get('lazer')).toEqual({ spentCents: 50000, committedCents: 0 });
    expect(byCategory.get('')).toEqual({ spentCents: 900, committedCents: 0 });
    const needs = bucketBudget(input({ txs }), config, 100000).needs;
    expect(needs.spentCents + needs.committedCents).toBe(15000);
  });

  it('RN-04: transferências e pagamentos de fatura nunca contam; cancelados e duplicados também não', () => {
    const txs = [
      tx({ kind: 'transfer', categoryId: 'mercado', counterpartAccountId: 'vr' }),
      tx({ kind: 'transfer', categoryId: 'mercado', counterpartCardId: cardA.id }),
      tx({ status: 'cancelled' }),
      tx({ reviewState: 'merged' }),
      tx({ reviewState: 'suggested' }),
      tx({ reviewState: 'ignored' }),
      tx({ deletedAt: 'x' }),
    ];
    const result = bucketBudget(input({ txs }), config, 100000);
    expect(result.needs.spentCents + result.needs.committedCents).toBe(0);
  });

  it('RN-45: compra no cartão conta no mês de vencimento (caixa) e parcela futura é "vai sair"', () => {
    const months = new Map([
      ['fatura-nov', '2026-11'],
      ['fatura-dez', '2026-12'],
    ]);
    const txs = [
      tx({
        cardId: cardA.id,
        accountId: null,
        invoiceId: 'fatura-nov',
        occurredOn: '2026-10-20',
        amountCents: 3000,
      }),
      tx({
        cardId: cardA.id,
        accountId: null,
        invoiceId: 'fatura-dez',
        occurredOn: '2026-11-10',
        amountCents: 9000,
      }),
    ];
    const nov = bucketBudget(input({ txs, invoiceMonthById: months }), config, 100000);
    expect(nov.needs.spentCents).toBe(3000);
    const dec = bucketBudget(
      input({ txs, invoiceMonthById: months, month: '2026-12' }),
      config,
      100000,
    );
    expect(dec.needs.spentCents).toBe(9000);
    const parcela = tx({
      cardId: cardA.id,
      accountId: null,
      invoiceId: 'fatura-dez',
      installmentNumber: 2,
      amountCents: 500,
    });
    expect(isPredicted(parcela, '2026-11-15', months)).toBe(true);
    expect(isPredicted(parcela, '2026-12-15', months)).toBe(false);
    expect(
      isPredicted(tx({ installmentNumber: 2, invoiceId: 'sem-mapa' }), '2026-11-15', months),
    ).toBe(false);
  });

  it('RN-41: "A classificar" e sem categoria vão para o grupo "Sem faixa"', () => {
    const txs = [
      tx({ categoryId: 'a-classificar', amountCents: 1500 }),
      tx({ categoryId: null, amountCents: 500 }),
      tx({}),
    ];
    expect(unbucketed(input({ txs }))).toEqual({ count: 2, spentCents: 2000, committedCents: 0 });
    const result = bucketBudget(input({ txs }), config, 100000);
    expect(result.needs.spentCents).toBe(1000);
  });

  it('RN-48: Base zero → metas zero e sem alerta', () => {
    const result = bucketBudget(input({ txs: [tx({ amountCents: 99999 })] }), config, 0);
    expect(result.needs).toMatchObject({ targetCents: 0, usageBp: 0, level: 'ok' });
  });

  it('acima da meta vira over', () => {
    expect(
      bucketBudget(input({ txs: [tx({ amountCents: 60000 })] }), config, 100000).needs.level,
    ).toBe('over');
    expect(
      bucketBudget(input({ txs: [tx({ amountCents: 50000 })] }), config, 100000).needs.level,
    ).toBe('warning');
  });
});

describe('limites, alertas e configuração', () => {
  it('limite por categoria usa a mesma soma da faixa', () => {
    const txs = [tx({ amountCents: 8500 }), tx({ categoryId: 'lazer', amountCents: 100 })];
    expect(
      categoryBudgets(input({ txs }), [
        { categoryId: 'mercado', limitCents: 10000, alertThresholdsBp: [8000, 10000] },
        { categoryId: 'lazer', limitCents: 0, alertThresholdsBp: [8000] },
      ]),
    ).toEqual([
      {
        categoryId: 'mercado',
        spentCents: 8500,
        limitCents: 10000,
        usageBp: 8500,
        level: 'warning',
      },
      { categoryId: 'lazer', spentCents: 100, limitCents: 0, usageBp: 0, level: 'ok' },
    ]);
  });

  it('RN-92: thresholdCrossings lista todas as faixas cruzadas', () => {
    expect(
      thresholdCrossings(
        [
          { scope: 'bucket', ref: 'wants', usageBp: 10200, thresholdsBp: [10000, 8000] },
          { scope: 'category', ref: 'mercado', usageBp: 7999, thresholdsBp: [8000] },
        ],
        '2026-11',
      ),
    ).toEqual([
      { scope: 'bucket', ref: 'wants', thresholdBp: 8000, month: '2026-11' },
      { scope: 'bucket', ref: 'wants', thresholdBp: 10000, month: '2026-11' },
    ]);
  });

  it('RN-43: o registro do mês sobrepõe o padrão; sem registros, 50/30/20', () => {
    expect(resolveBudgetConfig([], '2026-11')).toEqual({
      pctBp: { needs: 5000, wants: 3000, savings: 2000 },
      alertThresholdsBp: [8000, 10000],
    });
    const rows = [
      {
        month: null,
        scope: 'bucket',
        bucket: 'needs' as const,
        pctBp: 6000,
        alertThresholdsBp: [9000],
      },
      {
        month: null,
        scope: 'bucket',
        bucket: 'wants' as const,
        pctBp: 2000,
        alertThresholdsBp: [9000],
      },
      {
        month: '2026-11',
        scope: 'bucket',
        bucket: 'needs' as const,
        pctBp: 5500,
        alertThresholdsBp: [7000, 10000],
      },
      { month: null, scope: 'category', bucket: null, pctBp: null, alertThresholdsBp: [1] },
    ];
    expect(resolveBudgetConfig(rows, '2026-11')).toEqual({
      pctBp: { needs: 5500, wants: 2000, savings: 2000 },
      alertThresholdsBp: [7000, 10000],
    });
    expect(resolveBudgetConfig(rows, '2026-12').pctBp.needs).toBe(6000);
  });
});
