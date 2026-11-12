// Testes do reminders-tick com relógio injetado (US-39, US-40, RN-86..RN-89): store em memória com a mesma
// semântica das RPCs da migração 09 (dedupe, fila com lease, enviados no dia local) e sender falso.
import assert from 'node:assert/strict';
import type { PushSender, PushTarget, VapidConfig } from '../_shared/push.ts';
import {
  handleRemindersTick,
  type OutboxResult,
  type RunStatus,
  type SubscriptionResult,
  type TickDeps,
  type TickStats,
  type TickStore,
} from './handler.ts';
import {
  type ClaimedEntry,
  localParts,
  type NoticeRow,
  type OutboxRow,
  type SendContext,
  type SnapshotTx,
  type UserSnapshot,
} from './tick.ts';

const TZ = 'America/Sao_Paulo';
const USER = '0a000000-0000-4000-8000-000000000001';
const CARD = 'c0000000-0000-5000-8000-000000000001';
const INVOICE = '10000000-0000-5000-8000-000000000001';
const VAPID: VapidConfig = { publicKey: 'p', privateKey: 'k', subject: 'mailto:ops@example.test' };
const SECRET = 'sb_secret_teste';

/** Horário de Brasília (UTC−3) → instante. */
const brt = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

interface OutboxItem extends OutboxRow {
  id: string;
  userId: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts: number;
  sentAt: Date | null;
  error: string | null;
}

interface World {
  settings: Record<string, unknown>;
  reminders: UserSnapshot['reminders'];
  txs: SnapshotTx[];
  manualCreatedAt: Date[];
  subscriptions: (PushTarget & { disabled: boolean })[];
  notices: Map<string, NoticeRow>;
  outbox: OutboxItem[];
  runs: { status: RunStatus | 'running'; stats?: TickStats; error?: string }[];
  /** status HTTP por inscrição (padrão 201) */
  statuses: Record<string, number>;
  pushes: { target: string; payload: string; urgency: string; topic: string }[];
}

function world(over: Partial<World> = {}): World {
  return {
    settings: {},
    reminders: [],
    // fatura dez/2026 de R$ 980,00 (US-40)
    txs: [
      {
        id: 't1',
        kind: 'expense',
        status: 'posted',
        amountCents: 98_000,
        cardId: CARD,
        counterpartCardId: null,
        invoiceId: INVOICE,
        reviewState: 'ok',
      },
    ],
    manualCreatedAt: [],
    subscriptions: [
      {
        id: 's1',
        endpoint: 'https://push.example.test/1',
        p256dh: 'p',
        auth: 'a',
        disabled: false,
      },
    ],
    notices: new Map(),
    outbox: [],
    runs: [],
    statuses: {},
    pushes: [],
    ...over,
  };
}

function loggedOn(w: World, now: Date): string[] {
  const from = now.getTime() - 3 * 86_400_000;
  return [
    ...new Set(
      w.manualCreatedAt
        .filter((d) => d.getTime() > from && d.getTime() <= now.getTime())
        .map((d) => localParts(d, TZ).date),
    ),
  ];
}

function memoryStore(w: World): TickStore {
  return {
    start: () => {
      w.runs.push({ status: 'running' });
      return Promise.resolve(w.runs.length);
    },
    finish: (run, status, stats, error) => {
      w.runs[run - 1] = { status, stats, ...(error ? { error } : {}) };
      return Promise.resolve();
    },
    snapshot: (now) =>
      Promise.resolve([
        {
          userId: USER,
          timezone: TZ,
          settings: w.settings,
          hasPush: w.subscriptions.some((s) => !s.disabled),
          reminders: w.reminders,
          cards: { [CARD]: 'Nubank' },
          invoices: [
            {
              id: INVOICE,
              cardId: CARD,
              referenceMonth: '2026-12',
              closingDate: '2026-12-03',
              dueDate: '2026-12-10',
            },
          ],
          txs: w.txs,
          loggedOn: loggedOn(w, now),
        },
      ]),
    save: (userId, notices, outbox) => {
      for (const n of notices) {
        if (!w.notices.has(n.dedupeKey)) {
          w.notices.set(n.dedupeKey, n);
        }
      }
      let enqueued = 0;
      for (const o of outbox) {
        if (!w.outbox.some((x) => x.dedupeKey === o.dedupeKey)) {
          w.outbox.push({
            ...o,
            id: `o${w.outbox.length + 1}`,
            userId,
            status: 'pending',
            attempts: 0,
            sentAt: null,
            error: null,
          });
          enqueued++;
        }
      }
      return Promise.resolve(enqueued);
    },
    claim: (now, limit) => {
      const due = w.outbox
        .filter((o) => o.status === 'pending' && new Date(o.scheduledFor) <= now)
        .slice(0, limit);
      for (const o of due) {
        o.attempts += 1;
        o.scheduledFor = new Date(now.getTime() + 10 * 60_000).toISOString();
      }
      return Promise.resolve(
        due.map<ClaimedEntry>((o) => ({
          id: o.id,
          userId: o.userId,
          kind: o.kind,
          dedupeKey: o.dedupeKey,
          payload: o.payload,
          attempts: o.attempts,
        })),
      );
    },
    context: (_userId, now): Promise<SendContext> => {
      const today = localParts(now, TZ).date;
      return Promise.resolve({
        subscriptions: w.subscriptions
          .filter((s) => !s.disabled)
          .map(({ id, endpoint, p256dh, auth }) => ({ id, endpoint, p256dh, auth })),
        sentToday: w.outbox.filter(
          (o) => o.status === 'sent' && o.sentAt && localParts(o.sentAt, TZ).date === today,
        ).length,
        loggedOn: loggedOn(w, now),
      });
    },
    record: (now, outbox: OutboxResult[], subs: SubscriptionResult[]) => {
      for (const r of outbox) {
        const o = w.outbox.find((x) => x.id === r.id) as OutboxItem;
        o.status = r.status;
        o.error = r.error ?? null;
        if (r.status === 'sent') {
          o.sentAt = now;
        }
      }
      for (const r of subs) {
        const s = w.subscriptions.find((x) => x.id === r.id);
        if (s && r.outcome === 'gone') {
          s.disabled = true;
        }
      }
      return Promise.resolve();
    },
  };
}

function deps(w: World, now: Date, over: Partial<TickDeps> = {}): TickDeps {
  const sender: PushSender = {
    send(target, payload, options) {
      w.pushes.push({ target: target.id, payload, urgency: options.urgency, topic: options.topic });
      return Promise.resolve(w.statuses[target.id] ?? 201);
    },
  };
  return {
    storeFor: (request) => (request.headers.get('apikey') === SECRET ? memoryStore(w) : null),
    now: () => now,
    appOrigin: 'https://app.example.test',
    vapid: VAPID,
    sender: () => sender,
    ...over,
  };
}

const post = (key: string | null = SECRET) =>
  new Request('https://fn.example.test/reminders-tick', {
    method: 'POST',
    headers: key ? { apikey: key } : {},
    body: '{}',
  });

async function tick(w: World, now: Date, over: Partial<TickDeps> = {}) {
  const response = await handleRemindersTick(post(), deps(w, now, over));
  assert.equal(response.status, 200);
  return (await response.json()) as { enqueued: number; sent: number; failed: number };
}

function pushed(w: World): { title: string; body: string; navigate: string; tag: string }[] {
  return w.pushes.map((p) => JSON.parse(p.payload).notification);
}

const sameDayTitles = (w: World, prefix: string) =>
  [...w.notices.keys()].filter((k) => k.startsWith(prefix)).sort();

// ---------------------------------------------------------------- US-40 / RN-89 / RN-88

Deno.test('US-40: vencimento — lembretes em 07/12 e 10/12 às 09:00 com "R$ 980,00"', async () => {
  const w = world();
  assert.deepEqual(await tick(w, brt('2026-12-07', '09:00')), { enqueued: 1, sent: 1, failed: 0 });
  await tick(w, brt('2026-12-10', '09:00'));
  const [d3, d0] = pushed(w);
  assert.equal(d3?.title, 'Fatura Nubank vence em 3 dias');
  assert.equal(d3?.body, 'R$\u00A0980,00 com vencimento em 10/12.');
  assert.equal(d3?.navigate, `https://app.example.test/cartoes/${CARD}/fatura/2026-12`);
  assert.equal(d0?.title, 'Fatura Nubank vence hoje');
  assert.equal(d0?.body, 'R$\u00A0980,00. Após pagar, registre o pagamento no app.');
  assert.deepEqual(
    w.pushes.map((p) => [p.topic, p.urgency]),
    [
      ['invoice_due', 'normal'],
      ['invoice_due', 'high'],
    ],
  );
  assert.deepEqual(sameDayTitles(w, 'invoice_due'), [
    `invoice_due:${INVOICE}:d0`,
    `invoice_due:${INVOICE}:d3`,
  ]);
});

Deno.test('RN-86: tolerância de 15 min — o tick das 09:14 envia, o das 09:15 não; e não repete', async () => {
  const late = world();
  await tick(late, brt('2026-12-07', '09:14'));
  assert.equal(late.pushes.length, 1);
  await tick(late, brt('2026-12-07', '09:29'));
  assert.equal(late.pushes.length, 1, 'mesmo dedupe_key não sai de novo');
  const missed = world();
  await tick(missed, brt('2026-12-07', '09:15'));
  assert.equal(missed.pushes.length, 0);
  assert.equal(missed.notices.size, 0);
});

Deno.test('US-40: paga antes — pagamento em 06/12 cancela os lembretes de 07/12 e 10/12', async () => {
  const w = world();
  w.txs.push({
    id: 'pay',
    kind: 'transfer',
    status: 'posted',
    amountCents: 98_000,
    cardId: null,
    counterpartCardId: CARD,
    invoiceId: INVOICE,
    reviewState: 'ok',
  });
  await tick(w, brt('2026-12-07', '09:00'));
  await tick(w, brt('2026-12-10', '09:00'));
  assert.equal(w.pushes.length, 0);
  assert.equal(w.notices.size, 0);
});

Deno.test('RN-89: pagamento parcial avisa com o valor restante', async () => {
  const w = world();
  w.txs.push({
    id: 'pay',
    kind: 'transfer',
    status: 'posted',
    amountCents: 50_000,
    cardId: null,
    counterpartCardId: CARD,
    invoiceId: INVOICE,
    reviewState: 'ok',
  });
  await tick(w, brt('2026-12-07', '09:00'));
  assert.equal(pushed(w)[0]?.body, 'R$\u00A0480,00 com vencimento em 10/12.');
});

Deno.test('US-40: fechamento — 03/12/2026 às 09:00 "Fatura Nubank de dez/2026 fechou"', async () => {
  const w = world();
  await tick(w, brt('2026-12-03', '09:00'));
  const [closed] = pushed(w);
  assert.equal(closed?.title, 'Fatura Nubank de dez/2026 fechou');
  assert.equal(closed?.body, 'Total de R$\u00A0980,00, com vencimento em 10/12.');
  assert.equal(closed?.tag, `invoice_closed:${INVOICE}`);
});

Deno.test('US-40: valores ocultos — o push e o aviso não mostram o valor', async () => {
  const w = world({ settings: { hideValues: true } });
  await tick(w, brt('2026-12-07', '09:00'));
  const [d3] = pushed(w);
  assert.equal(d3?.body, 'R$\u00A0•••• com vencimento em 10/12.');
  assert.ok(!JSON.stringify([...w.notices.values()]).includes('980'));
});

Deno.test('RN-86: tipo desligado nas configurações não gera aviso nem push', async () => {
  const w = world({
    reminders: [
      {
        kind: 'invoice_due',
        enabled: false,
        localTime: '09:00',
        weekday: null,
        daysBefore: [3, 0],
        skipIfLoggedToday: true,
      },
    ],
  });
  await tick(w, brt('2026-12-07', '09:00'));
  assert.equal(w.notices.size, 0);
  assert.equal(w.pushes.length, 0);
});

// ---------------------------------------------------------------- US-39 / RN-87

Deno.test('US-39: sem lançamento no dia — às 20:00 "Registrar gastos de hoje"', async () => {
  const w = world();
  await tick(w, brt('2026-12-08', '20:05'));
  const [daily] = pushed(w);
  assert.equal(daily?.title, 'Registrar gastos de hoje');
  assert.equal(daily?.body, 'Nenhum lançamento hoje. Registre agora para manter o mês atualizado.');
  assert.equal(daily?.navigate, 'https://app.example.test/?novo=despesa');
  assert.ok(w.notices.has('daily_log:2026-12-08'));
});

Deno.test('US-39: já lancei às 12:00 — não recebo o lembrete diário', async () => {
  const w = world({ manualCreatedAt: [brt('2026-12-08', '12:00')] });
  await tick(w, brt('2026-12-08', '20:00'));
  assert.equal(w.pushes.length, 0);
  assert.equal(w.notices.size, 0);
});

const at23 = {
  kind: 'daily_log',
  enabled: true,
  localTime: '23:00',
  weekday: null,
  daysBefore: [0],
  skipIfLoggedToday: true,
};

Deno.test('US-39: horário no silêncio — aviso na hora, push às 08:00 do dia seguinte', async () => {
  const w = world({ reminders: [at23] });
  assert.deepEqual(await tick(w, brt('2026-12-08', '23:00')), { enqueued: 1, sent: 0, failed: 0 });
  assert.ok(w.notices.has('daily_log:2026-12-08'), 'a central recebe o aviso na hora');
  assert.equal(w.outbox[0]?.scheduledFor, brt('2026-12-09', '08:00').toISOString());
  await tick(w, brt('2026-12-09', '07:45'));
  assert.equal(w.pushes.length, 0, 'ainda no silêncio');
  await tick(w, brt('2026-12-09', '08:00'));
  assert.equal(pushed(w)[0]?.title, 'Registrar gastos de hoje');
});

Deno.test('US-39: horário no silêncio — descartado se lancei algo do dia anterior antes das 08:00', async () => {
  const w = world({ reminders: [at23] });
  await tick(w, brt('2026-12-08', '23:00'));
  w.manualCreatedAt.push(brt('2026-12-08', '23:30'));
  await tick(w, brt('2026-12-09', '08:00'));
  assert.equal(w.pushes.length, 0);
  assert.equal(w.outbox[0]?.status, 'skipped');
  assert.equal(w.outbox[0]?.error, 'logged');
});

Deno.test('US-39: lançamento só no dia seguinte não descarta o lembrete do dia anterior', async () => {
  const w = world({ reminders: [at23] });
  await tick(w, brt('2026-12-08', '23:00'));
  w.manualCreatedAt.push(brt('2026-12-09', '07:30'));
  await tick(w, brt('2026-12-09', '08:00'));
  assert.equal(w.pushes.length, 1);
});

// ---------------------------------------------------------------- RN-86 / UX 6.7 / tech §6.4.4

Deno.test('RN-86: sem inscrição push, só a central de avisos', async () => {
  const w = world({ subscriptions: [] });
  assert.deepEqual(await tick(w, brt('2026-12-07', '09:00')), { enqueued: 0, sent: 0, failed: 0 });
  assert.equal(w.notices.size, 1);
  assert.equal(w.outbox.length, 0);
});

Deno.test('SETUP-11 pendente: sem VAPID, grava só os avisos e não envia', async () => {
  const w = world();
  assert.deepEqual(await tick(w, brt('2026-12-07', '09:00'), { vapid: null }), {
    enqueued: 0,
    sent: 0,
    failed: 0,
  });
  assert.equal(w.notices.size, 1);
  assert.equal(w.pushes.length, 0);
  assert.equal(w.runs[0]?.status, 'ok');
  assert.equal(w.runs[0]?.stats?.push, false);
});

Deno.test('UX 6.7: no máximo 3 push por dia; os excedentes ficam só na central', async () => {
  const w = world();
  w.outbox.push(
    ...[1, 2, 3].map((n) => ({
      id: `old${n}`,
      userId: USER,
      kind: 'invoice_closed' as const,
      dedupeKey: `invoice_closed:x${n}`,
      payload: {},
      scheduledFor: brt('2026-12-07', '08:00').toISOString(),
      status: 'sent' as const,
      attempts: 1,
      sentAt: brt('2026-12-07', `08:0${n}`),
      error: null,
    })),
  );
  const result = await tick(w, brt('2026-12-07', '09:00'));
  assert.deepEqual(result, { enqueued: 1, sent: 0, failed: 0 });
  assert.equal(w.pushes.length, 0);
  assert.ok(w.notices.has(`invoice_due:${INVOICE}:d3`));
  assert.equal(w.outbox.at(-1)?.status, 'skipped');
  assert.equal(w.outbox.at(-1)?.error, 'daily_cap');
});

Deno.test('tech §6.4.4: 410 desativa a inscrição; o push vai para as outras', async () => {
  const w = world({ statuses: { s1: 410 } });
  w.subscriptions.push({
    id: 's2',
    endpoint: 'https://push.example.test/2',
    p256dh: 'p',
    auth: 'a',
    disabled: false,
  });
  assert.deepEqual(await tick(w, brt('2026-12-07', '09:00')), { enqueued: 1, sent: 1, failed: 0 });
  assert.equal(w.subscriptions[0]?.disabled, true);
  assert.equal(w.subscriptions[1]?.disabled, false);
});

Deno.test('tech §6.4.4: 429/5xx tenta de novo nos próximos ticks e falha na 3ª tentativa', async () => {
  const w = world({ statuses: { s1: 503 } });
  await tick(w, brt('2026-12-07', '09:00'));
  assert.equal(w.outbox[0]?.status, 'pending');
  await tick(w, brt('2026-12-07', '09:15'));
  assert.equal(w.outbox[0]?.status, 'pending');
  const third = await tick(w, brt('2026-12-07', '09:30'));
  assert.equal(third.failed, 1);
  assert.equal(w.outbox[0]?.status, 'failed');
  assert.equal(w.outbox[0]?.attempts, 3);
  assert.equal(w.pushes.length, 3);
});

Deno.test('job_runs: cada tick grava a execução com as contagens', async () => {
  const w = world();
  await tick(w, brt('2026-12-07', '09:00'));
  assert.equal(w.runs[0]?.status, 'ok');
  assert.equal(w.runs[0]?.stats?.users, 1);
  assert.equal(w.runs[0]?.stats?.notices, 1);
  assert.equal(w.runs[0]?.stats?.sent, 1);
});

Deno.test('erro de um usuário vira status partial e não derruba o tick', async () => {
  const w = world();
  const store = memoryStore(w);
  const failing: TickStore = { ...store, save: () => Promise.reject(new Error('falhou')) };
  const response = await handleRemindersTick(post(), {
    ...deps(w, brt('2026-12-07', '09:00')),
    storeFor: () => failing,
  });
  assert.equal(response.status, 200);
  assert.equal(w.runs[0]?.status, 'partial');
});

Deno.test('erro geral (snapshot) grava status error e responde INTERNAL', async () => {
  const w = world();
  const store = memoryStore(w);
  const failing: TickStore = { ...store, snapshot: () => Promise.reject(new TypeError('x')) };
  const response = await handleRemindersTick(post(), {
    ...deps(w, brt('2026-12-07', '09:00')),
    storeFor: () => failing,
  });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, 'INTERNAL');
  assert.deepEqual(w.runs[0], { status: 'error', stats: w.runs[0]?.stats, error: 'TypeError' });
});

Deno.test('auth secret: sem a chave secreta responde 401 e não toca no banco', async () => {
  const w = world();
  const response = await handleRemindersTick(post('outra'), deps(w, brt('2026-12-07', '09:00')));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
  assert.equal(w.runs.length, 0);
  const none = await handleRemindersTick(post(null), deps(w, brt('2026-12-07', '09:00')));
  assert.equal(none.status, 401);
});

Deno.test('só aceita POST', async () => {
  const w = world();
  const response = await handleRemindersTick(
    new Request('https://fn.example.test/reminders-tick', { headers: { apikey: SECRET } }),
    deps(w, brt('2026-12-07', '09:00')),
  );
  assert.equal(response.status, 405);
});
