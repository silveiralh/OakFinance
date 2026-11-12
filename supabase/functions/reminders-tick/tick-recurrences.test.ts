// Contas fixas e receitas no reminders-tick (T-091): US-41, RN-90, RN-91, RN-34; textos #3, #19 e #20 da UX 6.7.
import assert from 'node:assert/strict';
import { recurrenceTxId } from '../_shared/domain/index.ts';
import {
  dueForUser,
  planUser,
  type SnapshotRecurrence,
  type SnapshotRecurrenceTx,
  TICK_KINDS,
  type UserSnapshot,
} from './tick.ts';

const TZ = 'America/Sao_Paulo';
const brt = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);
const BILL_KINDS = ['bill_due', 'bill_overdue', 'income_unconfirmed'];

const LUZ: SnapshotRecurrence = {
  id: 'e4100000-0000-5000-8000-000000000001',
  kind: 'expense',
  description: 'Luz',
  amountCents: 18000,
  isVariableAmount: true,
  categoryId: null,
  accountId: 'a4100000-0000-5000-8000-000000000001',
  cardId: null,
  paymentMethod: 'pix',
  isFixedIncome: false,
  autoPost: false,
  remind: true,
  frequency: 'monthly',
  intervalCount: 1,
  dayOfMonth: 20,
  weekday: null,
  monthOfYear: null,
  startOn: '2026-01-20',
  endOn: null,
  maxOccurrences: null,
};

const SALARIO: SnapshotRecurrence = {
  ...LUZ,
  id: 'e4100000-0000-5000-8000-000000000002',
  kind: 'income',
  description: 'Salário',
  amountCents: 500000,
  isVariableAmount: false,
  paymentMethod: 'transfer',
  isFixedIncome: true,
  dayOfMonth: 5,
  startOn: '2026-01-05',
};

const ASSINATURA: SnapshotRecurrence = {
  ...LUZ,
  id: 'e4100000-0000-5000-8000-000000000003',
  description: 'Streaming',
  amountCents: 3990,
  isVariableAmount: false,
  accountId: null,
  cardId: 'c4100000-0000-5000-8000-000000000001',
  paymentMethod: 'credit',
  autoPost: true,
};

const snap = (over: Partial<UserSnapshot> = {}): UserSnapshot => ({
  userId: '0a000000-0000-4000-8000-000000000041',
  timezone: TZ,
  settings: {},
  hasPush: true,
  reminders: [],
  cards: {},
  invoices: [],
  txs: [],
  loggedOn: [],
  recurrences: [LUZ, SALARIO, ASSINATURA],
  recurrenceTxs: [],
  ...over,
});

const occurrenceTx = (
  rec: SnapshotRecurrence,
  date: string,
  status: 'pending' | 'posted' | 'cancelled',
): SnapshotRecurrenceTx => ({
  id: recurrenceTxId(rec.id, date),
  kind: rec.kind,
  status,
  amountCents: rec.amountCents,
  occurredOn: date,
  description: rec.description,
  recurrenceId: rec.id,
  recurrenceDate: date,
  reviewState: 'ok',
});

const bills = (s: UserSnapshot, now: Date) =>
  dueForUser(s, now).filter((n) => BILL_KINDS.includes(n.kind));

Deno.test('T-091: contas fixas e receitas entram nos tipos ligados do tick', () => {
  for (const kind of BILL_KINDS) {
    assert.ok(TICK_KINDS.includes(kind as (typeof TICK_KINDS)[number]), kind);
  }
});

Deno.test('US-41 Véspera: "Luz vence amanhã" / "≈ R$ 180,00 em 20/11." às 09:00 de 19/11 (RN-90, UX #3)', () => {
  const due = bills(snap(), brt('2026-11-19', '09:00'));
  assert.equal(due.length, 1);
  assert.equal(due[0]?.kind, 'bill_due');
  assert.equal(due[0]?.title, 'Luz vence amanhã');
  assert.equal(due[0]?.body, '≈ R$\u00A0180,00 em 20/11.');
  assert.equal(due[0]?.navigate, `/lancamentos/${recurrenceTxId(LUZ.id, '2026-11-20')}`);
  // fora da janela das 09:00 e em outro dia, nada
  assert.equal(bills(snap(), brt('2026-11-19', '10:00')).length, 0);
  assert.equal(bills(snap(), brt('2026-11-18', '09:00')).length, 0);
});

Deno.test('RN-90: valor fixo sai sem o "≈"', () => {
  const fixed = { ...LUZ, isVariableAmount: false, description: 'Aluguel', amountCents: 150000 };
  const due = bills(snap({ recurrences: [fixed] }), brt('2026-11-19', '09:00'));
  assert.equal(due[0]?.body, 'R$\u00A01.500,00 em 20/11.');
});

Deno.test('US-41 Atrasada: em 21/11 a Luz ainda prevista gera "Confirmar Luz" com ação na T02 (RN-91, UX #19)', () => {
  const pendingTx = occurrenceTx(LUZ, '2026-11-20', 'pending');
  const due = bills(snap({ recurrenceTxs: [pendingTx] }), brt('2026-11-21', '09:00'));
  assert.equal(due.length, 1);
  assert.equal(due[0]?.kind, 'bill_overdue');
  assert.equal(due[0]?.title, 'Confirmar Luz');
  assert.equal(due[0]?.body, 'Venceu em 20/11. Confirme o pagamento ou pule este mês.');
  assert.equal(due[0]?.navigate, `/lancamentos/${pendingTx.id}`);
  assert.equal(due[0]?.dedupeKey, `bill_overdue:${LUZ.id}:2026-11-20`);
  // sem lançamento (ocorrência só projetada) também está prevista
  assert.equal(bills(snap(), brt('2026-11-21', '09:00'))[0]?.kind, 'bill_overdue');
});

Deno.test('RN-91: confirmada ou pulada, não há aviso de atraso', () => {
  for (const status of ['posted', 'cancelled'] as const) {
    const s = snap({ recurrenceTxs: [occurrenceTx(LUZ, '2026-11-20', status)] });
    assert.equal(bills(s, brt('2026-11-21', '09:00')).length, 0, status);
  }
});

Deno.test('US-41 Receita: salário de 05/12 não confirmado gera "Confirmar Salário" em 06/12 às 09:00 (RN-91, RN-34, UX #20)', () => {
  const due = bills(snap(), brt('2026-12-06', '09:00'));
  assert.equal(due.length, 1);
  assert.equal(due[0]?.kind, 'income_unconfirmed');
  assert.equal(due[0]?.title, 'Confirmar Salário');
  assert.equal(due[0]?.body, 'Prevista para 05/12. Confirme o valor recebido ou mude a data.');
  assert.equal(due[0]?.navigate, `/lancamentos/${recurrenceTxId(SALARIO.id, '2026-12-05')}`);
  // confirmado: nada
  const ok = snap({ recurrenceTxs: [occurrenceTx(SALARIO, '2026-12-05', 'posted')] });
  assert.equal(bills(ok, brt('2026-12-06', '09:00')).length, 0);
});

Deno.test('RN-34: receita avulsa A receber de ontem também pede confirmação', () => {
  const freela: SnapshotRecurrenceTx = {
    id: '74100000-0000-5000-8000-000000000003',
    kind: 'income',
    status: 'pending',
    amountCents: 30000,
    occurredOn: '2026-11-20',
    description: 'Freela',
    recurrenceId: null,
    recurrenceDate: null,
    reviewState: 'ok',
  };
  const due = bills(snap({ recurrences: [], recurrenceTxs: [freela] }), brt('2026-11-21', '09:00'));
  assert.equal(due.length, 1);
  assert.equal(due[0]?.title, 'Confirmar Freela');
  assert.equal(due[0]?.navigate, `/lancamentos/${freela.id}`);
});

Deno.test('US-41 Assinatura no cartão: recorrência no cartão com confirmação automática não gera lembrete', () => {
  // vence 20/11 (véspera 19/11) e 21/11 seria o atraso
  const s = snap({ recurrences: [ASSINATURA] });
  assert.equal(bills(s, brt('2026-11-19', '09:00')).length, 0);
  assert.equal(bills(s, brt('2026-11-21', '09:00')).length, 0);
  // em meio imediato mas com confirmação automática, também não
  const auto = { ...LUZ, autoPost: true };
  assert.equal(bills(snap({ recurrences: [auto] }), brt('2026-11-19', '09:00')).length, 0);
});

Deno.test('RN-90: recorrência sem lembrete (remind = false) não gera aviso', () => {
  const quiet = { ...LUZ, remind: false };
  assert.equal(bills(snap({ recurrences: [quiet] }), brt('2026-11-19', '09:00')).length, 0);
});

Deno.test('RN-91: uma vez por ocorrência — o aviso tem dedupe_key por recorrência e data, e o push vai às 09:00', () => {
  const now = brt('2026-11-21', '09:00');
  const plan = planUser(snap(), now, { pushEnabled: true, appOrigin: 'https://app.example.test/' });
  const overdue = plan.notices.filter((n) => n.kind === 'bill_overdue');
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0]?.dedupeKey, `bill_overdue:${LUZ.id}:2026-11-20`);
  const push = plan.outbox.find((o) => o.kind === 'bill_overdue');
  assert.equal(push?.scheduledFor, now.toISOString());
});

Deno.test('preferência do usuário: bill_due desligado em S07 não avisa', () => {
  const s = snap({
    reminders: [
      {
        kind: 'bill_due',
        enabled: false,
        localTime: '09:00',
        weekday: null,
        daysBefore: [1],
        skipIfLoggedToday: false,
      },
    ],
  });
  assert.equal(bills(s, brt('2026-11-19', '09:00')).length, 0);
});

Deno.test('snapshot antigo (sem recorrências) continua funcionando', () => {
  const old = snap();
  delete old.recurrences;
  delete old.recurrenceTxs;
  assert.equal(bills(old, brt('2026-11-19', '09:00')).length, 0);
});
