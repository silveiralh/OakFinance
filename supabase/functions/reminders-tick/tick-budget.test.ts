// Alertas de limite e resumo semanal no reminders-tick (T-092): US-42, US-43, RN-92, RN-93; textos #5, #6, #8 e #8b
// da UX 6.7.
import assert from 'node:assert/strict';
import type { Tx } from '../_shared/domain/index.ts';
import {
  budgetOf,
  categoryLimitsOf,
  dueForUser,
  type SnapshotBudget,
  type SnapshotMonth,
  TICK_KINDS,
  type UserSnapshot,
} from './tick.ts';

const TZ = 'America/Sao_Paulo';
const brt = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const ACC = 'a4200000-0000-5000-8000-000000000001';

let seq = 0;
const tx = (over: Partial<Tx>): Tx => ({
  id: `74200000-0000-5000-8000-${String(++seq).padStart(12, '0')}`,
  kind: 'expense',
  status: 'posted',
  countBeforeReceived: false,
  invoicePinned: false,
  amountCents: 0,
  occurredOn: '2026-11-03',
  description: null,
  categoryId: null,
  paymentMethod: 'pix',
  accountId: ACC,
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
});

const category = (id: string, name: string, bucket: 'needs' | 'wants' | 'savings' | 'income') => ({
  id,
  name,
  parentId: null,
  kind: bucket === 'income' ? ('income' as const) : ('expense' as const),
  bucket,
  slug: null,
  feedsReserve: false,
  isSystem: false,
});

const CATEGORIES = [
  category('cat-salario', 'Salário', 'income'),
  category('cat-lazer', 'Lazer', 'wants'),
  category('cat-mercado', 'Mercado', 'needs'),
  category('cat-farmacia', 'Farmácia', 'needs'),
  category('cat-reserva', 'Reserva', 'savings'),
];

/** Renda de R$ 5.800,00 → Desejos (30%) = R$ 1.740,00. */
const salary = () =>
  tx({ kind: 'income', amountCents: 580000, occurredOn: '2026-11-05', categoryId: 'cat-salario' });

const month = (txs: Tx[], over: Partial<SnapshotMonth> = {}): SnapshotMonth => ({
  txs,
  recurrences: [],
  accounts: [
    {
      id: ACC,
      type: 'checking',
      isRestricted: false,
      includeInSpendable: true,
      initialBalanceCents: 0,
      initialBalanceOn: '2026-01-01',
    },
  ],
  cards: [],
  categories: CATEGORIES,
  invoiceMonths: {},
  budgets: [],
  ...over,
});

const snap = (m: SnapshotMonth | undefined, over: Partial<UserSnapshot> = {}): UserSnapshot => ({
  userId: '0a000000-0000-4000-8000-000000000042',
  timezone: TZ,
  settings: {},
  hasPush: true,
  reminders: [],
  cards: {},
  invoices: [],
  txs: [],
  loggedOn: [],
  ...(m ? { month: m } : {}),
  ...over,
});

const budgetNotes = (s: UserSnapshot, now: Date) =>
  dueForUser(s, now).filter((n) => n.kind === 'budget_threshold');

Deno.test('T-092: limite e resumo semanal entram nos tipos ligados do tick', () => {
  assert.ok(TICK_KINDS.includes('budget_threshold'));
  assert.ok(TICK_KINDS.includes('weekly_summary'));
});

Deno.test('US-42: Desejos a 80% com R$ 1.380,00 + R$ 20,00 em Lazer (meta R$ 1.740,00), UX #5', () => {
  const before = month([salary(), tx({ amountCents: 138000, categoryId: 'cat-lazer' })]);
  assert.equal(budgetNotes(snap(before), brt('2026-11-10', '14:15')).length, 0);
  const after = month([
    salary(),
    tx({ amountCents: 138000, categoryId: 'cat-lazer' }),
    tx({ amountCents: 2000, categoryId: 'cat-lazer', occurredOn: '2026-11-10' }),
  ]);
  const due = budgetNotes(snap(after), brt('2026-11-10', '14:15'));
  assert.equal(due.length, 1);
  assert.equal(due[0]?.title, 'Desejos atingiu 80% do planejado');
  assert.equal(due[0]?.body, 'Restam R$ 340,00 até o fim do mês.');
  assert.equal(due[0]?.dedupeKey, 'budget:wants:2026-11:8000');
  assert.equal(due[0]?.navigate, '/planejar/orcamento');
});

Deno.test('US-42: ao passar de R$ 1.740,00, "Desejos acima do planejado" (UX #6) e não de novo em novembro', () => {
  const over = month([salary(), tx({ amountCents: 175000, categoryId: 'cat-lazer' })]);
  const first = budgetNotes(snap(over), brt('2026-11-12', '09:30'));
  assert.equal(first.length, 1);
  assert.equal(first[0]?.title, 'Desejos acima do planejado');
  assert.equal(first[0]?.body, 'R$ 10,00 acima do previsto para nov/2026. Veja onde ajustar.');
  // RN-92: máximo 1 por (faixa, limiar, mês) — a mesma chave em todo tick do mês (a central e a fila ignoram)
  const later = budgetNotes(snap(over), brt('2026-11-20', '18:45'));
  assert.deepEqual(
    later.map((n) => n.dedupeKey),
    first.map((n) => n.dedupeKey),
  );
  assert.equal(first[0]?.dedupeKey, 'budget:wants:2026-11:10000');
});

Deno.test('US-42 Vindo de importação: o consumo de um importado conta na execução seguinte', () => {
  // Necessidades = 50% de R$ 5.800,00 = R$ 2.900,00; 80% = R$ 2.320,00
  const imported = tx({
    amountCents: 232000,
    categoryId: 'cat-mercado',
    source: 'pluggy',
    reviewState: 'new',
  });
  const due = budgetNotes(snap(month([salary(), imported])), brt('2026-11-10', '10:00'));
  assert.deepEqual(
    due.map((n) => n.title),
    ['Necessidades atingiu 80% do planejado'],
  );
});

Deno.test('US-42 Sem renda: com Base = 0 nenhum alerta de faixa é enviado', () => {
  const m = month([tx({ amountCents: 900000, categoryId: 'cat-lazer' })]);
  assert.equal(budgetNotes(snap(m), brt('2026-11-10', '10:00')).length, 0);
});

Deno.test('RN-92: Poupança não tem alerta, mesmo acima da meta', () => {
  const m = month([salary(), tx({ amountCents: 200000, categoryId: 'cat-reserva' })]);
  assert.equal(budgetNotes(snap(m), brt('2026-11-10', '10:00')).length, 0);
});

Deno.test('RN-92/RN-45: categoria com limite a 80% avisa com o nome da categoria', () => {
  const budgets = [
    {
      month: null,
      scope: 'category',
      bucket: null,
      categoryId: 'cat-farmacia',
      pctBp: null,
      limitCents: 20000,
      alertThresholdsBp: [8000, 10000],
    },
  ];
  const m = month([salary(), tx({ amountCents: 17000, categoryId: 'cat-farmacia' })], { budgets });
  const due = budgetNotes(snap(m), brt('2026-11-10', '10:00'));
  assert.deepEqual(
    due.map((n) => [n.title, n.dedupeKey]),
    [['Farmácia atingiu 80% do planejado', 'budget:cat-farmacia:2026-11:8000']],
  );
});

Deno.test('RN-43/RN-45: percentuais e limites do mês sobrepõem o padrão', () => {
  const budgets: SnapshotBudget[] = [
    {
      month: null,
      scope: 'bucket',
      bucket: 'wants',
      categoryId: null,
      pctBp: 3000,
      limitCents: null,
      alertThresholdsBp: [8000, 10000],
    },
    {
      month: '2026-11',
      scope: 'bucket',
      bucket: 'wants',
      categoryId: null,
      pctBp: 2500,
      limitCents: null,
      alertThresholdsBp: [9000],
    },
    {
      month: null,
      scope: 'category',
      bucket: null,
      categoryId: 'cat-lazer',
      pctBp: null,
      limitCents: 30000,
      alertThresholdsBp: [8000],
    },
    {
      month: '2026-11',
      scope: 'category',
      bucket: null,
      categoryId: 'cat-lazer',
      pctBp: null,
      limitCents: 0,
      alertThresholdsBp: [8000],
    },
  ];
  const cfg = budgetOf(budgets, '2026-11');
  assert.equal(cfg.pctBp.wants, 2500);
  assert.deepEqual(cfg.alertThresholdsBp, [9000]);
  assert.equal(budgetOf(budgets, '2026-12').pctBp.wants, 3000);
  // limite zerado no mês = sem limite naquele mês
  assert.deepEqual(categoryLimitsOf(budgets, '2026-11'), []);
  assert.equal(categoryLimitsOf(budgets, '2026-12')[0]?.limitCents, 30000);
});

const weekly = (s: UserSnapshot, now: Date) =>
  dueForUser(s, now).filter((n) => n.kind === 'weekly_summary');

Deno.test('US-43 Domingo à noite: total, 3 maiores categorias, disponível e "Dias com lançamento: 6/7" às 19:00 de 15/11 (UX #8)', () => {
  const m = month([
    salary(),
    tx({ amountCents: 30000, categoryId: 'cat-mercado', occurredOn: '2026-11-09' }),
    tx({ amountCents: 12000, categoryId: 'cat-lazer', occurredOn: '2026-11-11' }),
    tx({ amountCents: 4500, categoryId: 'cat-farmacia', occurredOn: '2026-11-13' }),
    tx({ amountCents: 8000, categoryId: 'cat-mercado', occurredOn: '2026-11-15' }),
    // fora da semana: não entra no total
    tx({ amountCents: 99900, categoryId: 'cat-lazer', occurredOn: '2026-11-08' }),
  ]);
  const loggedOn = [
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
    '2026-11-15',
  ];
  const due = weekly(snap(m, { loggedOn }), brt('2026-11-15', '19:00'));
  assert.equal(due.length, 1);
  assert.equal(due[0]?.title, 'Resumo da semana');
  assert.match(
    due[0]?.body ?? '',
    /^R\$ 545,00 em gastos, maiores: Mercado, Lazer, Farmácia\. Dias com lançamento: 6\/7\. Disponível: R\$ [\d.]+,\d{2}\.$/,
  );
  assert.equal(due[0]?.dedupeKey, 'weekly:2026-W46');
  assert.equal(due[0]?.navigate, '/');
});

Deno.test('US-43 Semana sem lançamentos: versão curta (UX #8b)', () => {
  const due = weekly(snap(month([salary()])), brt('2026-11-15', '19:00'));
  assert.equal(due.length, 1);
  assert.equal(
    due[0]?.body,
    'Nenhum lançamento nesta semana. Registre seus gastos para manter o mês em dia.',
  );
});

Deno.test('RN-93: só no dia e hora configurados (padrão domingo 19:00)', () => {
  const s = snap(month([salary()]));
  assert.equal(weekly(s, brt('2026-11-14', '19:00')).length, 0, 'sábado');
  assert.equal(weekly(s, brt('2026-11-15', '18:00')).length, 0, 'domingo antes da hora');
  const moved = snap(month([salary()]), {
    reminders: [
      {
        kind: 'weekly_summary',
        enabled: true,
        localTime: '08:30',
        weekday: 1,
        daysBefore: [0],
        skipIfLoggedToday: false,
      },
    ],
  });
  assert.equal(weekly(moved, brt('2026-11-16', '08:30')).length, 1, 'segunda 08:30 configurado');
});

Deno.test('snapshot sem o mês (antigo): limite e resumo ficam de fora, o resto continua', () => {
  const s = snap(undefined);
  assert.equal(budgetNotes(s, brt('2026-11-10', '10:00')).length, 0);
  assert.equal(weekly(s, brt('2026-11-15', '19:00')).length, 0);
  assert.equal(
    dueForUser(s, brt('2026-11-15', '20:00')).filter((n) => n.kind === 'daily_log').length,
    1,
  );
});
