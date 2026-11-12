import { describe, expect, it } from 'vitest';
import type { BudgetConfig, MonthInput } from '../src/budget.ts';
import { recurrenceTxId } from '../src/ids.ts';
import { type InvoiceTotals, invoicePeriod } from '../src/invoices.ts';
import { formatBRL } from '../src/money.ts';
import {
  BODY_MAX,
  type DueNotification,
  type DueNotificationsInput,
  dayMonth,
  deliverAt,
  dueNotifications,
  firedOn,
  isoWeek,
  monthLabel,
  type ReminderPref,
  stillDue,
  TITLE_MAX,
} from '../src/notifications.ts';
import type { Recurrence } from '../src/recurrence.ts';
import { DEFAULT_PROFILE_SETTINGS, resolveProfileSettings } from '../src/settings.ts';
import { DEFAULT_SPENDABLE_CONFIG, spendableThisMonth } from '../src/spendable.ts';
import type { Card, Category, Tx } from '../src/types.ts';

const cat = (id: string, bucket: Category['bucket'], kind: Category['kind'] = 'expense') => ({
  id,
  parentId: null,
  kind,
  bucket,
  slug: id,
  feedsReserve: false,
  isSystem: false,
});
const categories: Category[] = [
  cat('mercado', 'needs'),
  cat('moradia', 'needs'),
  cat('contas', 'needs'),
  cat('lazer', 'wants'),
  cat('reserva', 'savings'),
  cat('salario', 'income', 'income'),
];
const NAMES = {
  mercado: 'Mercado',
  moradia: 'Moradia',
  contas: 'Contas da casa',
  lazer: 'Lazer',
  reserva: 'Reserva',
};
const NU: Card = {
  id: 'nubank',
  closingDay: 3,
  dueDay: 10,
  closingDayRule: 'next',
  limitCents: null,
  paymentAccountId: 'bb',
};
const budget: BudgetConfig = {
  pctBp: { needs: 5000, wants: 3000, savings: 2000 },
  alertThresholdsBp: [8000, 10000],
};

let seq = 0;
function tx(over: Partial<Tx>): Tx {
  seq += 1;
  return {
    id: `tx-${seq}`,
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

function rec(over: Partial<Recurrence>): Recurrence {
  return {
    id: 'rec-luz',
    kind: 'expense',
    description: 'Luz',
    amountCents: 18_000,
    isVariableAmount: true,
    categoryId: 'contas',
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
    startOn: '2026-01-20',
    ...over,
  };
}

const salary = (cents = 580_000) =>
  tx({ kind: 'income', categoryId: 'salario', amountCents: cents, occurredOn: '2026-11-05' });

function month(today: string, txs: Tx[] = [], recurrences: Recurrence[] = []): MonthInput {
  return {
    month: today.slice(0, 7),
    today,
    txs,
    recurrences,
    cards: [NU],
    accounts: [
      {
        id: 'bb',
        type: 'checking',
        isRestricted: false,
        includeInSpendable: true,
        initialBalanceCents: 0,
        initialBalanceOn: '2026-01-01',
      },
    ],
    categories,
    invoiceMonthById: new Map(),
    attribution: 'invoice_due_month',
    includeRestrictedAccounts: true,
  };
}

function input(
  date: string,
  time: string,
  over: Partial<DueNotificationsInput> & { txs?: Tx[] } = {},
): DueNotificationsInput {
  const { txs = [], ...rest } = over;
  const recurrences = rest.recurrences ?? [];
  return {
    nowLocal: { date, time },
    windowMinutes: 15,
    prefs: [],
    month: month(date, txs, [...recurrences]),
    budget,
    spendable: DEFAULT_SPENDABLE_CONFIG,
    invoices: [],
    recurrences,
    hideValues: false,
    labels: { cards: { nubank: 'Nubank' }, categories: NAMES },
    loggedOn: [],
    ...rest,
  };
}

const kinds = (list: DueNotification[]) => list.map((n) => n.kind);
const only = (list: DueNotification[], kind: DueNotification['kind']) =>
  list.filter((n) => n.kind === kind);

function pref(kind: ReminderPref['kind'], over: Partial<ReminderPref>): ReminderPref {
  return {
    kind,
    enabled: true,
    localTime: '09:00',
    weekday: null,
    daysBefore: [0],
    skipIfLoggedToday: true,
    ...over,
  };
}

const dez = invoicePeriod(NU, '2026-12');
const totals = (balance: number, charges = balance, payments = 0): InvoiceTotals => ({
  chargesCents: charges,
  creditsCents: 0,
  paymentsCents: payments,
  balanceCents: balance,
});

describe('RN-86: janela do tick, silêncio e formatos', () => {
  it('RN-86: dispara quando o horário cai em (agora − 15 min, agora], inclusive atravessando a meia-noite', () => {
    const now = (time: string, date = '2026-11-05') => ({ date, time });
    expect(firedOn(now('20:00'), '20:00', 15)).toBe('2026-11-05');
    expect(firedOn(now('20:14'), '20:00', 15)).toBe('2026-11-05');
    expect(firedOn(now('20:15'), '20:00', 15)).toBeNull();
    expect(firedOn(now('19:59'), '20:00', 15)).toBeNull();
    expect(firedOn(now('00:05', '2026-11-06'), '23:55', 15)).toBe('2026-11-05');
    expect(firedOn(now('00:05', '2026-11-06'), '23:40', 15)).toBeNull();
    expect(firedOn(now('xx'), '20:00', 15)).toBeNull();
  });

  it('RN-86: silêncio 22:00–08:00 adia para as 08:00; fora dele entrega na hora', () => {
    const quiet = DEFAULT_PROFILE_SETTINGS.quietHours;
    expect(deliverAt({ date: '2026-11-05', time: '23:00' }, quiet)).toEqual({
      date: '2026-11-06',
      time: '08:00',
    });
    expect(deliverAt({ date: '2026-11-06', time: '07:59' }, quiet)).toEqual({
      date: '2026-11-06',
      time: '08:00',
    });
    expect(deliverAt({ date: '2026-11-06', time: '08:00' }, quiet)).toEqual({
      date: '2026-11-06',
      time: '08:00',
    });
    expect(deliverAt({ date: '2026-11-05', time: '21:59' }, quiet).time).toBe('21:59');
    const lunch = { start: '13:00', end: '14:00' };
    expect(deliverAt({ date: '2026-11-05', time: '13:30' }, lunch)).toEqual({
      date: '2026-11-05',
      time: '14:00',
    });
    expect(deliverAt({ date: '2026-11-05', time: '15:00' }, lunch).time).toBe('15:00');
    expect(
      deliverAt({ date: '2026-11-05', time: '23:00' }, { start: '00:00', end: '00:00' }).time,
    ).toBe('23:00');
  });

  it('formatos: "dez/2026", "dd/mm" e semana ISO', () => {
    expect(monthLabel('2026-12')).toBe('dez/2026');
    expect(monthLabel('2027-01')).toBe('jan/2027');
    expect(dayMonth('2026-12-10')).toBe('10/12');
    expect(isoWeek('2026-11-15')).toBe('2026-W46');
    expect(isoWeek('2026-11-09')).toBe('2026-W46');
    expect(isoWeek('2027-01-01')).toBe('2026-W53');
    expect(isoWeek('2024-12-30')).toBe('2025-W01');
  });
});

describe('daily_log (US-39, RN-87)', () => {
  it('US-39: sem lançamento no dia, às 20:00 recebo o lembrete com o texto do UX', () => {
    const [n, ...rest] = dueNotifications(input('2026-11-05', '20:00'));
    expect(rest).toEqual([]);
    expect(n).toEqual({
      kind: 'daily_log',
      dedupeKey: 'daily_log:2026-11-05',
      title: 'Registrar gastos de hoje',
      body: 'Nenhum lançamento hoje. Registre agora para manter o mês atualizado.',
      navigate: '/?novo=despesa',
      refDate: '2026-11-05',
    });
    expect(kinds(dueNotifications(input('2026-11-05', '20:14')))).toEqual(['daily_log']);
    expect(dueNotifications(input('2026-11-05', '20:15'))).toEqual([]);
  });

  it('US-39: já lancei às 12:00 → sem lembrete (por created_at local ou, na falta, pelo lançamento manual)', () => {
    expect(dueNotifications(input('2026-11-05', '20:00', { loggedOn: ['2026-11-05'] }))).toEqual(
      [],
    );
    const viaTx = input('2026-11-05', '20:00', { txs: [tx({ occurredOn: '2026-11-05' })] });
    delete viaTx.loggedOn;
    expect(only(dueNotifications(viaTx), 'daily_log')).toEqual([]);
    const imported = input('2026-11-05', '20:00', {
      txs: [tx({ occurredOn: '2026-11-05', source: 'pluggy' })],
    });
    delete imported.loggedOn;
    expect(kinds(dueNotifications(imported))).toEqual(['daily_log']);
    const always = input('2026-11-05', '20:00', {
      loggedOn: ['2026-11-05'],
      prefs: [pref('daily_log', { localTime: '20:00', skipIfLoggedToday: false })],
    });
    expect(kinds(dueNotifications(always))).toEqual(['daily_log']);
    const off = input('2026-11-05', '20:00', {
      prefs: [pref('daily_log', { localTime: '20:00', enabled: false })],
    });
    expect(dueNotifications(off)).toEqual([]);
  });

  it('US-39: configurado para 23:00 com silêncio, sai às 08:00 só se o dia anterior seguir sem lançamento', () => {
    const at23 = input('2026-11-05', '23:00', {
      prefs: [pref('daily_log', { localTime: '23:00' })],
    });
    const [n] = dueNotifications(at23);
    if (!n) {
      throw new Error('lembrete esperado');
    }
    expect(deliverAt(at23.nowLocal, DEFAULT_PROFILE_SETTINGS.quietHours)).toEqual({
      date: '2026-11-06',
      time: '08:00',
    });
    expect(stillDue(n, [])).toBe(true);
    expect(stillDue(n, ['2026-11-06'])).toBe(true);
    expect(stillDue(n, ['2026-11-05'])).toBe(false);
    expect(stillDue({ ...n, kind: 'weekly_summary' }, ['2026-11-05'])).toBe(true);
    const { refDate: _ref, ...withoutRef } = n;
    expect(stillDue(withoutRef, ['2026-11-05'])).toBe(true);
  });
});

describe('invoice_due e invoice_closed (US-40, RN-88, RN-89)', () => {
  const invoice = (balance: number, payments = 0) => ({
    ...dez,
    totals: totals(balance, 98_000, payments),
  });

  it('US-40: fatura dez/2026 de R$ 980,00, vencimento 10/12 → lembretes em 07/12 e 10/12 às 09:00', () => {
    const d3 = dueNotifications(input('2026-12-07', '09:00', { invoices: [invoice(98_000)] }));
    expect(only(d3, 'invoice_due')).toEqual([
      {
        kind: 'invoice_due',
        dedupeKey: `invoice_due:${dez.id}:d3`,
        title: 'Fatura Nubank vence em 3 dias',
        body: 'R$\u00a0980,00 com vencimento em 10/12.',
        navigate: '/cartoes/nubank/fatura/2026-12',
      },
    ]);
    const d0 = dueNotifications(input('2026-12-10', '09:00', { invoices: [invoice(98_000)] }));
    expect(only(d0, 'invoice_due')).toEqual([
      {
        kind: 'invoice_due',
        dedupeKey: `invoice_due:${dez.id}:d0`,
        title: 'Fatura Nubank vence hoje',
        body: 'R$\u00a0980,00. Após pagar, registre o pagamento no app.',
        navigate: '/cartoes/nubank/fatura/2026-12',
      },
    ]);
    expect(dueNotifications(input('2026-12-08', '09:00', { invoices: [invoice(98_000)] }))).toEqual(
      [],
    );
    expect(dueNotifications(input('2026-12-07', '09:15', { invoices: [invoice(98_000)] }))).toEqual(
      [],
    );
  });

  it('RN-89: o valor é o restante; paga antes (06/12) não gera lembrete', () => {
    const partial = dueNotifications(
      input('2026-12-07', '09:00', { invoices: [invoice(68_000, 30_000)] }),
    );
    expect(partial[0]?.body).toBe('R$\u00a0680,00 com vencimento em 10/12.');
    expect(
      dueNotifications(input('2026-12-07', '09:00', { invoices: [invoice(0, 98_000)] })),
    ).toEqual([]);
    expect(
      dueNotifications(input('2026-12-10', '09:00', { invoices: [invoice(0, 98_000)] })),
    ).toEqual([]);
  });

  it('RN-89: dias configurados fora do padrão usam "vence amanhã" e "vence em N dias"', () => {
    const prefs = [pref('invoice_due', { daysBefore: [5, 1] })];
    const n5 = dueNotifications(
      input('2026-12-05', '09:00', { invoices: [invoice(98_000)], prefs }),
    );
    expect(n5.map((n) => [n.dedupeKey, n.title])).toEqual([
      [`invoice_due:${dez.id}:d5`, 'Fatura Nubank vence em 5 dias'],
    ]);
    const n1 = dueNotifications(
      input('2026-12-09', '09:00', { invoices: [invoice(98_000)], prefs }),
    );
    expect(n1[0]?.title).toBe('Fatura Nubank vence amanhã');
  });

  it('US-40: em 03/12/2026 às 09:00 recebo "Fatura Nubank de dez/2026 fechou"', () => {
    const list = dueNotifications(input('2026-12-03', '09:00', { invoices: [invoice(98_000)] }));
    expect(only(list, 'invoice_closed')).toEqual([
      {
        kind: 'invoice_closed',
        dedupeKey: `invoice_closed:${dez.id}`,
        title: 'Fatura Nubank de dez/2026 fechou',
        body: 'Total de R$\u00a0980,00, com vencimento em 10/12.',
        navigate: '/cartoes/nubank/fatura/2026-12',
      },
    ]);
  });

  it('RN-88: só com total > 0; sem nome do cartão usa um rótulo neutro', () => {
    const zero = { ...dez, totals: { ...totals(0, 0) } };
    expect(dueNotifications(input('2026-12-03', '09:00', { invoices: [zero] }))).toEqual([]);
    const unnamed = dueNotifications(
      input('2026-12-03', '09:00', { invoices: [invoice(98_000)], labels: {} }),
    );
    expect(unnamed[0]?.title).toBe('Fatura do cartão de dez/2026 fechou');
  });

  it('US-40: com "Ocultar valores" o push não mostra o valor', () => {
    const list = [
      ...dueNotifications(
        input('2026-12-07', '09:00', { invoices: [invoice(98_000)], hideValues: true }),
      ),
      ...dueNotifications(
        input('2026-12-03', '09:00', { invoices: [invoice(98_000)], hideValues: true }),
      ),
    ];
    expect(list).toHaveLength(2);
    for (const n of list) {
      expect(n.body).toContain('R$\u00a0••••');
      expect(n.body).not.toContain('980');
    }
  });
});

describe('bill_due, bill_overdue e income_unconfirmed (US-41, RN-90, RN-91)', () => {
  it('US-41: "Luz" prevista para 20/11 em Pix → em 19/11 às 09:00 "Luz vence amanhã" / "≈ R$ 180,00 em 20/11."', () => {
    const luz = rec({});
    const list = dueNotifications(input('2026-11-19', '09:00', { recurrences: [luz] }));
    expect(only(list, 'bill_due')).toEqual([
      {
        kind: 'bill_due',
        dedupeKey: 'bill_due:rec-luz:2026-11-20:d1',
        title: 'Luz vence amanhã',
        body: '≈ R$\u00a0180,00 em 20/11.',
        navigate: `/lancamentos/${recurrenceTxId('rec-luz', '2026-11-20')}`,
      },
    ]);
    const fixed = dueNotifications(
      input('2026-11-19', '09:00', { recurrences: [rec({ isVariableAmount: false })] }),
    );
    expect(fixed[0]?.body).toBe('R$\u00a0180,00 em 20/11.');
    const hidden = dueNotifications(
      input('2026-11-19', '09:00', { recurrences: [luz], hideValues: true }),
    );
    expect(hidden[0]?.body).toBe('R$\u00a0•••• em 20/11.');
  });

  it('RN-90: dias configurados (hoje, 3 dias) e ocorrência já confirmada não geram lembrete de véspera', () => {
    const prefs = [pref('bill_due', { daysBefore: [0, 3] })];
    const today = dueNotifications(input('2026-11-20', '09:00', { recurrences: [rec({})], prefs }));
    expect(today.map((n) => [n.dedupeKey, n.title])).toEqual([
      ['bill_due:rec-luz:2026-11-20:d0', 'Luz vence hoje'],
    ]);
    const three = dueNotifications(input('2026-11-17', '09:00', { recurrences: [rec({})], prefs }));
    expect(three[0]?.title).toBe('Luz vence em 3 dias');
    const paid = tx({ recurrenceId: 'rec-luz', recurrenceDate: '2026-11-20', status: 'posted' });
    expect(
      dueNotifications(input('2026-11-19', '09:00', { recurrences: [rec({})], txs: [paid] })),
    ).toEqual([]);
    const scheduled = tx({
      id: 'agendada',
      recurrenceId: 'rec-luz',
      recurrenceDate: '2026-11-20',
      status: 'pending',
      amountCents: 19_000,
    });
    const still = dueNotifications(
      input('2026-11-19', '09:00', { recurrences: [rec({})], txs: [scheduled] }),
    );
    expect(still[0]).toMatchObject({
      body: '≈ R$\u00a0190,00 em 20/11.',
      navigate: '/lancamentos/agendada',
    });
  });

  it('US-41: em 21/11 a "Luz" continua prevista → "Confirmar Luz"', () => {
    const list = dueNotifications(input('2026-11-21', '09:00', { recurrences: [rec({})] }));
    expect(only(list, 'bill_overdue')).toEqual([
      {
        kind: 'bill_overdue',
        dedupeKey: 'bill_overdue:rec-luz:2026-11-20',
        title: 'Confirmar Luz',
        body: 'Venceu em 20/11. Confirme o pagamento ou pule este mês.',
        navigate: `/lancamentos/${recurrenceTxId('rec-luz', '2026-11-20')}`,
      },
    ]);
    const paid = tx({ recurrenceId: 'rec-luz', recurrenceDate: '2026-11-20' });
    expect(
      dueNotifications(input('2026-11-21', '09:00', { recurrences: [rec({})], txs: [paid] })),
    ).toEqual([]);
  });

  it('US-41: salário de 05/12 não confirmado → em 06/12 às 09:00 "Confirmar Salário"; receita avulsa também', () => {
    const sal = rec({
      id: 'rec-sal',
      kind: 'income',
      description: 'Salário',
      amountCents: 580_000,
      isVariableAmount: false,
      categoryId: 'salario',
      dayOfMonth: 5,
      startOn: '2026-01-05',
      isFixedIncome: true,
    });
    const loose = tx({
      id: 'freela',
      kind: 'income',
      status: 'pending',
      occurredOn: '2026-12-05',
      categoryId: 'salario',
      description: null,
    });
    const list = only(
      dueNotifications(input('2026-12-06', '09:00', { recurrences: [sal], txs: [loose] })),
      'income_unconfirmed',
    );
    expect(list).toEqual([
      {
        kind: 'income_unconfirmed',
        dedupeKey: 'income_unconfirmed:rec-sal:2026-12-05',
        title: 'Confirmar Salário',
        body: 'Prevista para 05/12. Confirme o valor recebido ou mude a data.',
        navigate: `/lancamentos/${recurrenceTxId('rec-sal', '2026-12-05')}`,
      },
      {
        kind: 'income_unconfirmed',
        dedupeKey: 'income_unconfirmed:freela:2026-12-05',
        title: 'Confirmar receita',
        body: 'Prevista para 05/12. Confirme o valor recebido ou mude a data.',
        navigate: '/lancamentos/freela',
      },
    ]);
    const realizedPending = tx({
      id: 'sal-pend',
      kind: 'income',
      status: 'pending',
      occurredOn: '2026-12-05',
      recurrenceId: 'rec-sal',
      recurrenceDate: '2026-12-05',
    });
    const once = only(
      dueNotifications(
        input('2026-12-06', '09:00', { recurrences: [sal], txs: [realizedPending] }),
      ),
      'income_unconfirmed',
    );
    expect(once.map((n) => n.navigate)).toEqual(['/lancamentos/sal-pend']);
    const confirmed = tx({
      kind: 'income',
      occurredOn: '2026-12-05',
      recurrenceId: 'rec-sal',
      recurrenceDate: '2026-12-05',
    });
    expect(
      dueNotifications(input('2026-12-06', '09:00', { recurrences: [sal], txs: [confirmed] })),
    ).toEqual([]);
    const auto = rec({ ...sal, autoPost: true });
    expect(dueNotifications(input('2026-12-06', '09:00', { recurrences: [auto] }))).toEqual([]);
  });

  it('US-41: assinatura no cartão com confirmação automática não gera lembrete de conta fixa', () => {
    const recs = [
      rec({
        id: 'stream',
        description: 'Streaming',
        cardId: 'nubank',
        paymentMethod: 'credit',
        autoPost: true,
      }),
      rec({ id: 'cartao-manual', cardId: 'nubank', paymentMethod: 'credit' }),
      rec({ id: 'credito-sem-cartao', paymentMethod: 'credit' }),
      rec({ id: 'pix-auto', autoPost: true }),
    ];
    for (const [date, time] of [
      ['2026-11-19', '09:00'],
      ['2026-11-21', '09:00'],
    ] as const) {
      expect(dueNotifications(input(date, time, { recurrences: recs }))).toEqual([]);
    }
  });
});

describe('budget_threshold (US-42, RN-92)', () => {
  const lazer = (cents: number) =>
    tx({ categoryId: 'lazer', amountCents: cents, occurredOn: '2026-11-04' });

  it('US-42: Desejos com meta R$ 1.740,00 e consumo R$ 1.380,00 + R$ 20,00 → "Desejos atingiu 80% do planejado"', () => {
    expect(
      only(
        dueNotifications(input('2026-11-05', '10:00', { txs: [salary(), lazer(138_000)] })),
        'budget_threshold',
      ),
    ).toEqual([]);
    const list = only(
      dueNotifications(
        input('2026-11-05', '10:00', { txs: [salary(), lazer(138_000), lazer(2_000)] }),
      ),
      'budget_threshold',
    );
    expect(list).toEqual([
      {
        kind: 'budget_threshold',
        dedupeKey: 'budget:wants:2026-11:8000',
        title: 'Desejos atingiu 80% do planejado',
        body: 'Restam R$\u00a0340,00 até o fim do mês.',
        navigate: '/planejar/orcamento',
      },
    ]);
  });

  it('US-42: ao passar de R$ 1.740,00 → "Desejos acima do planejado", só o maior limiar', () => {
    const list = only(
      dueNotifications(input('2026-11-05', '10:00', { txs: [salary(), lazer(175_000)] })),
      'budget_threshold',
    );
    expect(list).toEqual([
      {
        kind: 'budget_threshold',
        dedupeKey: 'budget:wants:2026-11:10000',
        title: 'Desejos acima do planejado',
        body: 'R$\u00a010,00 acima do previsto para nov/2026. Veja onde ajustar.',
        navigate: '/planejar/orcamento',
      },
    ]);
    // a mesma chave em novembro: o outbox não repete (on conflict do nothing)
    const again = only(
      dueNotifications(input('2026-11-06', '10:00', { txs: [salary(), lazer(176_000)] })),
      'budget_threshold',
    );
    expect(again.map((n) => n.dedupeKey)).toEqual(['budget:wants:2026-11:10000']);
  });

  it('US-42: Necessidades vindas da importação; sem renda (Base = 0) nenhum alerta; Poupança nunca', () => {
    const needs = only(
      dueNotifications(
        input('2026-11-05', '03:00', {
          txs: [salary(), tx({ categoryId: 'mercado', amountCents: 240_000, source: 'pluggy' })],
        }),
      ),
      'budget_threshold',
    );
    expect(needs.map((n) => [n.dedupeKey, n.title])).toEqual([
      ['budget:needs:2026-11:8000', 'Necessidades atingiu 80% do planejado'],
    ]);
    expect(dueNotifications(input('2026-11-05', '10:00', { txs: [lazer(500_000)] }))).toEqual([]);
    expect(
      only(
        dueNotifications(
          input('2026-11-05', '10:00', {
            txs: [salary(), tx({ categoryId: 'reserva', amountCents: 500_000 })],
          }),
        ),
        'budget_threshold',
      ),
    ).toEqual([]);
    const off = input('2026-11-05', '10:00', {
      txs: [salary(), lazer(175_000)],
      prefs: [pref('budget_threshold', { enabled: false })],
    });
    expect(dueNotifications(off)).toEqual([]);
  });

  it('RN-92: limite de categoria com limiares próprios; sem nome usa "Categoria"', () => {
    const base = { txs: [salary(), tx({ categoryId: 'mercado', amountCents: 45_000 })] };
    const list = only(
      dueNotifications(
        input('2026-11-05', '10:00', {
          ...base,
          categoryLimits: [
            { categoryId: 'mercado', limitCents: 50_000, alertThresholdsBp: [9000, 10000] },
          ],
        }),
      ),
      'budget_threshold',
    );
    expect(list).toEqual([
      {
        kind: 'budget_threshold',
        dedupeKey: 'budget:mercado:2026-11:9000',
        title: 'Mercado atingiu 90% do planejado',
        body: 'Restam R$\u00a050,00 até o fim do mês.',
        navigate: '/planejar/orcamento',
      },
    ]);
    const unnamed = only(
      dueNotifications(
        input('2026-11-05', '10:00', {
          ...base,
          labels: {},
          categoryLimits: [
            { categoryId: 'mercado', limitCents: 40_000, alertThresholdsBp: [8000, 10000] },
            { categoryId: 'lazer', limitCents: 0, alertThresholdsBp: [8000] },
          ],
        }),
      ),
      'budget_threshold',
    );
    expect(unnamed.map((n) => [n.title, n.body])).toEqual([
      [
        'Categoria acima do planejado',
        'R$\u00a050,00 acima do previsto para nov/2026. Veja onde ajustar.',
      ],
    ]);
  });
});

describe('weekly_summary (US-43, RN-93)', () => {
  const week = [
    salary(),
    tx({ categoryId: 'mercado', amountCents: 30_000, occurredOn: '2026-11-09' }),
    tx({ categoryId: 'lazer', amountCents: 20_000, occurredOn: '2026-11-10' }),
    tx({ categoryId: 'moradia', amountCents: 10_000, occurredOn: '2026-11-11' }),
    tx({ categoryId: 'contas', amountCents: 5_000, occurredOn: '2026-11-12' }),
    tx({ categoryId: 'mercado', amountCents: 9_999, occurredOn: '2026-11-08' }), // semana anterior
    tx({ categoryId: 'lazer', amountCents: 9_999, occurredOn: '2026-11-13', status: 'pending' }),
    tx({ kind: 'transfer', categoryId: null, amountCents: 9_999, occurredOn: '2026-11-13' }),
  ];
  const logged = [
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
    '2026-11-15',
    '2026-11-08',
  ];

  it('US-43: domingo 15/11 às 19:00 — total, 3 maiores categorias, disponível e "dias com lançamento: 6/7"', () => {
    const data = input('2026-11-15', '19:00', { txs: week, loggedOn: logged });
    const available = spendableThisMonth(
      data.month,
      budget,
      DEFAULT_SPENDABLE_CONFIG,
    ).availableCents;
    const list = only(dueNotifications(data), 'weekly_summary');
    expect(list).toEqual([
      {
        kind: 'weekly_summary',
        dedupeKey: 'weekly:2026-W46',
        title: 'Resumo da semana',
        body: `R$\u00a0650,00 em gastos, maiores: Mercado, Lazer, Moradia. Dias com lançamento: 6/7. Disponível: ${formatBRL(available)}.`,
        navigate: '/',
      },
    ]);
  });

  it('US-43: semana sem lançamentos → versão curta', () => {
    const list = only(
      dueNotifications(input('2026-11-15', '19:00', { txs: week, loggedOn: ['2026-11-08'] })),
      'weekly_summary',
    );
    expect(list).toEqual([
      {
        kind: 'weekly_summary',
        dedupeKey: 'weekly:2026-W46',
        title: 'Resumo da semana',
        body: 'Nenhum lançamento nesta semana. Registre seus gastos para manter o mês em dia.',
        navigate: '/?novo=despesa',
      },
    ]);
  });

  it('RN-93: só no dia configurado; valores ocultos; nomes longos cortam categorias para caber em 120', () => {
    expect(
      only(
        dueNotifications(input('2026-11-14', '19:00', { txs: week, loggedOn: logged })),
        'weekly_summary',
      ),
    ).toEqual([]);
    const monday = input('2026-11-16', '07:00', {
      txs: week,
      loggedOn: ['2026-11-16'],
      prefs: [pref('weekly_summary', { localTime: '07:00', weekday: 1 })],
    });
    expect(only(dueNotifications(monday), 'weekly_summary')[0]?.dedupeKey).toBe('weekly:2026-W47');
    const hidden = only(
      dueNotifications(
        input('2026-11-15', '19:00', { txs: week, loggedOn: logged, hideValues: true }),
      ),
      'weekly_summary',
    );
    expect(hidden[0]?.body).toBe(
      'R$\u00a0•••• em gastos, maiores: Mercado, Lazer, Moradia. Dias com lançamento: 6/7. Disponível: R$\u00a0••••.',
    );
    const long = 'Categoria com nome comprido';
    const names = { mercado: long, lazer: `${long} 2`, moradia: `${long} 3` };
    const cut = only(
      dueNotifications(
        input('2026-11-15', '19:00', {
          txs: week,
          loggedOn: logged,
          labels: { categories: names },
        }),
      ),
      'weekly_summary',
    );
    expect(cut[0]?.body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(cut[0]?.body).toContain(`maiores: ${long}.`);
    const noCats = only(
      dueNotifications(input('2026-11-15', '19:00', { txs: week, loggedOn: logged, labels: {} })),
      'weekly_summary',
    );
    expect(noCats[0]?.body.startsWith('R$\u00a0650,00 em gastos. Dias com lançamento: 6/7.')).toBe(
      true,
    );
  });
});

describe('bank_connection (RN-94)', () => {
  it('RN-94: erro de login, consentimento vencido e a ≤ 7 dias; uma chave por estado', () => {
    const list = dueNotifications(
      input('2026-11-05', '10:00', {
        connections: [
          { id: 'c1', bankName: 'Nubank', status: 'LOGIN_ERROR', consentExpiresOn: null },
          { id: 'c2', bankName: 'BB', status: 'UPDATED', consentExpiresOn: '2026-11-12' },
          { id: 'c3', bankName: 'BB', status: 'UPDATED', consentExpiresOn: '2026-11-13' },
          { id: 'c4', bankName: 'BB', status: 'updated', consentExpiresOn: '2026-11-05' },
          { id: 'c5', bankName: 'Nubank', status: 'OUTDATED', consentExpiresOn: '2027-01-01' },
        ],
      }),
    );
    expect(list.map((n) => n.dedupeKey)).toEqual([
      'bank:c1:login_error',
      'bank:c2:expiring',
      'bank:c4:expired',
      'bank:c5:outdated',
    ]);
    expect(list[0]).toMatchObject({
      kind: 'bank_connection',
      title: 'Conexão com o Nubank precisa de atenção',
      body: 'Renove para continuar recebendo lançamentos automaticamente.',
      navigate: '/ajustes/conexoes',
    });
    const off = input('2026-11-05', '10:00', {
      prefs: [pref('bank_connection', { enabled: false })],
      connections: [
        { id: 'c1', bankName: 'Nubank', status: 'LOGIN_ERROR', consentExpiresOn: null },
      ],
    });
    expect(dueNotifications(off)).toEqual([]);
  });
});

describe('textos do UX 6.7', () => {
  it('UX 6.7: título ≤ 40, corpo ≤ 120, sem "!" e sem emoji, inclusive com nomes longos', () => {
    const longName = 'Conta de energia elétrica da casa de praia';
    const all = [
      ...dueNotifications(
        input('2026-11-19', '09:00', {
          recurrences: [rec({ description: longName })],
          labels: { cards: { nubank: 'Cartão com um nome bem comprido demais' } },
        }),
      ),
      ...dueNotifications(
        input('2026-12-07', '09:00', { invoices: [{ ...dez, totals: totals(98_000) }] }),
      ),
      ...dueNotifications(input('2026-11-05', '20:00')),
    ];
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const n of all) {
      expect(n.title.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(n.body.length).toBeLessThanOrEqual(BODY_MAX);
      expect(`${n.title}${n.body}`).not.toMatch(/[!?]|\p{Extended_Pictographic}/u);
    }
    expect(all[0]?.title).toBe(`${longName.slice(0, TITLE_MAX - 1)}…`);
  });
});

describe('ProfileSettings', () => {
  it('padrões: silêncio 22:00–08:00, valores visíveis, tema do sistema e conciliação da RN-66', () => {
    expect(resolveProfileSettings(undefined)).toEqual(DEFAULT_PROFILE_SETTINGS);
    expect(resolveProfileSettings([])).toEqual(DEFAULT_PROFILE_SETTINGS);
    expect(DEFAULT_PROFILE_SETTINGS.quietHours).toEqual({ start: '22:00', end: '08:00' });
    expect(DEFAULT_PROFILE_SETTINGS.reconciliation.windowDays.recurrence).toBe(5);
  });

  it('mantém o que é válido e troca pelo padrão o que é inválido', () => {
    const s = resolveProfileSettings({
      hideValues: true,
      theme: 'dark',
      glass: 'neon',
      reduceMotion: 'on',
      quietHours: { start: '23:30', end: '25:00' },
      spendable: { savingsMode: 'none', cardAttribution: 'purchase_month', includeUpcoming: 'sim' },
      csvProfiles: [{ id: 'x' }],
      reconciliation: {
        windowDays: { card: 4, pix: -1 },
        suggestTolerance: { pctBp: 300 },
        lookbackDays: 1.5,
      },
    });
    expect(s.hideValues).toBe(true);
    expect(s.theme).toBe('dark');
    expect(s.glass).toBe('auto');
    expect(s.reduceMotion).toBe('on');
    expect(s.quietHours).toEqual({ start: '23:30', end: '08:00' });
    expect(s.spendable).toEqual({
      ...DEFAULT_SPENDABLE_CONFIG,
      savingsMode: 'none',
      cardAttribution: 'purchase_month',
    });
    expect(s.csvProfiles).toHaveLength(1);
    expect(s.reconciliation.windowDays).toMatchObject({ card: 4, pix: 1 });
    expect(s.reconciliation.suggestTolerance).toEqual({ minCents: 200, pctBp: 300 });
    expect(s.reconciliation.lookbackDays).toBe(90);
  });
});
