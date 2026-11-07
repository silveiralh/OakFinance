// Regras puras do reminders-tick (fuso, preferências, decisão de envio). RN-86..RN-89, US-39, UX 6.7.
import assert from 'node:assert/strict';
import { noticeId } from '../_shared/domain/index.ts';
import {
  DAILY_PUSH_CAP,
  entryOutcome,
  localParts,
  planUser,
  refDateOf,
  type SendContext,
  sendDecision,
  TICK_KINDS,
  tickPrefs,
  toTx,
  type UserSnapshot,
  urgencyOf,
  zonedToUtc,
} from './tick.ts';

const TZ = 'America/Sao_Paulo';
const brt = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

Deno.test('RN-86: horário local no fuso do perfil', () => {
  assert.deepEqual(localParts(new Date('2026-12-07T12:05:00Z'), TZ), {
    date: '2026-12-07',
    time: '09:05',
  });
  assert.deepEqual(localParts(new Date('2026-12-08T02:30:00Z'), TZ), {
    date: '2026-12-07',
    time: '23:30',
  });
});

Deno.test('RN-86: 08:00 de São Paulo é 11:00 UTC (e o caminho inverso fecha)', () => {
  assert.equal(
    zonedToUtc({ date: '2026-12-09', time: '08:00' }, TZ).toISOString(),
    '2026-12-09T11:00:00.000Z',
  );
  const back = localParts(zonedToUtc({ date: '2026-03-01', time: '00:15' }, TZ), TZ);
  assert.deepEqual(back, { date: '2026-03-01', time: '00:15' });
});

Deno.test('fuso com horário de verão: 08:00 em Nova York antes e depois da troca', () => {
  const zone = 'America/New_York';
  assert.equal(
    zonedToUtc({ date: '2026-01-15', time: '08:00' }, zone).toISOString(),
    '2026-01-15T13:00:00.000Z',
  );
  assert.equal(
    zonedToUtc({ date: '2026-07-15', time: '08:00' }, zone).toISOString(),
    '2026-07-15T12:00:00.000Z',
  );
});

Deno.test('T-064/T-091: diário, faturas, contas fixas e receitas ligados; o resto espera as próprias tarefas', () => {
  const prefs = tickPrefs([
    {
      kind: 'weekly_summary',
      enabled: true,
      localTime: '19:00',
      weekday: 0,
      daysBefore: [0],
      skipIfLoggedToday: true,
    },
    {
      kind: 'daily_log',
      enabled: true,
      localTime: '21:30',
      weekday: null,
      daysBefore: [0],
      skipIfLoggedToday: false,
    },
  ]);
  assert.deepEqual(
    prefs
      .filter((p) => p.enabled)
      .map((p) => p.kind)
      .sort(),
    [...TICK_KINDS].sort(),
  );
  const daily = prefs.find((p) => p.kind === 'daily_log');
  assert.equal(daily?.localTime, '21:30');
  assert.equal(daily?.skipIfLoggedToday, false);
  assert.equal(
    prefs.find((p) => p.kind === 'invoice_due')?.localTime,
    '09:00',
    'RN-89: padrão 09:00',
  );
  assert.deepEqual(
    prefs.find((p) => p.kind === 'invoice_due')?.daysBefore,
    [3, 0],
    'RN-89: D−3 e D0',
  );
});

Deno.test('toTx: lançamento no cartão é crédito, pagamento é transferência', () => {
  const base = {
    id: 'x',
    kind: 'expense' as const,
    status: 'posted' as const,
    amountCents: 100,
    counterpartCardId: null,
    invoiceId: 'i',
    reviewState: 'ok' as const,
  };
  assert.equal(toTx({ ...base, cardId: 'c' }).paymentMethod, 'credit');
  assert.equal(toTx({ ...base, cardId: null }).paymentMethod, 'transfer');
});

const snap = (over: Partial<UserSnapshot> = {}): UserSnapshot => ({
  userId: '0a000000-0000-4000-8000-000000000001',
  timezone: TZ,
  settings: {},
  hasPush: true,
  reminders: [],
  cards: {},
  invoices: [],
  txs: [],
  loggedOn: [],
  ...over,
});

Deno.test('RN-87: daily_log com id v5 da dedupe_key e push na hora fora do silêncio', () => {
  const now = brt('2026-12-08', '20:00');
  const plan = planUser(snap(), now, { pushEnabled: true, appOrigin: 'https://app.example.test/' });
  assert.equal(plan.notices.length, 1);
  assert.equal(plan.notices[0]?.id, noticeId(snap().userId, 'daily_log:2026-12-08'));
  assert.equal(plan.outbox[0]?.scheduledFor, now.toISOString());
  const payload = plan.outbox[0]?.payload as {
    web_push: number;
    notification: Record<string, unknown>;
  };
  assert.equal(payload.web_push, 8030);
  assert.equal(payload.notification.tag, 'daily_log:2026-12-08');
  assert.equal(payload.notification.lang, 'pt-BR');
});

Deno.test('RN-86: silêncio configurado pelo usuário adia o push para o fim dele', () => {
  const plan = planUser(
    snap({ settings: { quietHours: { start: '19:00', end: '07:00' } } }),
    brt('2026-12-08', '20:00'),
    { pushEnabled: true, appOrigin: 'https://app.example.test' },
  );
  assert.equal(plan.outbox[0]?.scheduledFor, brt('2026-12-09', '07:00').toISOString());
});

Deno.test('RN-86: sem push habilitado, só avisos', () => {
  const plan = planUser(snap(), brt('2026-12-08', '20:00'), {
    pushEnabled: false,
    appOrigin: 'https://app.example.test',
  });
  assert.equal(plan.notices.length, 1);
  assert.deepEqual(plan.outbox, []);
});

Deno.test('US-39: dia de referência vem da dedupe_key do daily_log', () => {
  assert.equal(refDateOf('daily_log:2026-12-08'), '2026-12-08');
  assert.equal(refDateOf('invoice_due:abc:d0'), undefined);
});

const ctx = (over: Partial<SendContext> = {}): SendContext => ({
  subscriptions: [{ id: 's', endpoint: 'https://push.example.test/s', p256dh: 'p', auth: 'a' }],
  sentToday: 0,
  loggedOn: [],
  ...over,
});
const entry = (kind: string, dedupeKey: string) => ({
  id: 'o',
  userId: 'u',
  kind,
  dedupeKey,
  payload: {},
  attempts: 1,
});

Deno.test('US-39 e UX 6.7: decisão antes de enviar', () => {
  assert.deepEqual(sendDecision(entry('daily_log', 'daily_log:2026-12-08'), ctx()), {
    action: 'send',
  });
  assert.deepEqual(
    sendDecision(entry('daily_log', 'daily_log:2026-12-08'), ctx({ loggedOn: ['2026-12-08'] })),
    { action: 'skip', reason: 'logged' },
  );
  assert.deepEqual(
    sendDecision(entry('invoice_due', 'invoice_due:i:d3'), ctx({ loggedOn: ['2026-12-08'] })),
    {
      action: 'send',
    },
  );
  assert.deepEqual(sendDecision(entry('invoice_due', 'k'), ctx({ subscriptions: [] })), {
    action: 'skip',
    reason: 'no_subscription',
  });
  assert.deepEqual(sendDecision(entry('invoice_due', 'k'), ctx({ sentToday: DAILY_PUSH_CAP })), {
    action: 'skip',
    reason: 'daily_cap',
  });
});

Deno.test('tech §6.4.4: resultado do item pela resposta das inscrições', () => {
  const r = (outcome: 'sent' | 'gone' | 'retry' | 'error') => ({ id: 's', outcome, status: 0 });
  assert.deepEqual(entryOutcome([r('gone'), r('sent')], 1), { status: 'sent' });
  assert.deepEqual(entryOutcome([r('retry')], 2), { status: 'pending' });
  assert.deepEqual(entryOutcome([r('retry')], 3), { status: 'failed', error: 'retry_exhausted' });
  assert.deepEqual(entryOutcome([r('gone')], 1), { status: 'failed', error: 'gone' });
  assert.deepEqual(entryOutcome([r('error'), r('gone')], 1), {
    status: 'failed',
    error: 'rejected',
  });
});

Deno.test('tech §6.4.3: Urgency high só no vencimento do dia', () => {
  assert.equal(urgencyOf({ kind: 'invoice_due', dedupeKey: 'invoice_due:i:d0' }), 'high');
  assert.equal(urgencyOf({ kind: 'invoice_due', dedupeKey: 'invoice_due:i:d3' }), 'normal');
  assert.equal(urgencyOf({ kind: 'daily_log', dedupeKey: 'daily_log:2026-12-08' }), 'normal');
});
