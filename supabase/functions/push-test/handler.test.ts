// Testes do handler do push-test (US-38), sem rede: inscrições e sender falsos.
import assert from 'node:assert/strict';
import type { PushSender, PushTarget, SendResult } from '../_shared/push.ts';
import { handlePushTest, type PushTestDeps, TEST_MESSAGE } from './handler.ts';

const VAPID = { publicKey: 'p', privateKey: 'k', subject: 'mailto:ops@example.test' };
const target = (id: string): PushTarget => ({
  id,
  endpoint: `https://push.example.test/${id}`,
  p256dh: 'p',
  auth: 'a',
});

function deps(over: Partial<PushTestDeps> = {}) {
  const sent: string[] = [];
  const recorded: SendResult[][] = [];
  const statuses: Record<string, number> = { a: 201, b: 410 };
  const sender: PushSender = {
    send(t, payload) {
      sent.push(payload);
      return Promise.resolve(statuses[t.id] ?? 201);
    },
  };
  const value: PushTestDeps = {
    cors: { appOrigin: 'https://app.example.test' },
    appOrigin: 'https://app.example.test',
    vapid: VAPID,
    sender: () => sender,
    subscriptions: (auth) =>
      Promise.resolve(auth === 'Bearer ok' ? [target('a'), target('b')] : null),
    record: (_auth, results) => {
      recorded.push([...results]);
      return Promise.resolve();
    },
    ...over,
  };
  return { value, sent, recorded };
}

const post = (auth?: string) =>
  new Request('https://fn.example.test/push-test', {
    method: 'POST',
    headers: { Origin: 'https://app.example.test', ...(auth ? { Authorization: auth } : {}) },
    body: '{}',
  });

Deno.test('US-38: envia "Lembretes ativos" às inscrições ativas e conta só as entregues', async () => {
  const { value, sent, recorded } = deps();
  const response = await handlePushTest(post('Bearer ok'), value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: 1 });
  const payload = JSON.parse(sent[0] ?? '{}');
  assert.equal(payload.notification.title, TEST_MESSAGE.title);
  assert.equal(payload.notification.body, 'É assim que os avisos de vencimento vão aparecer.');
  assert.equal(payload.notification.navigate, 'https://app.example.test/ajustes/lembretes');
  assert.deepEqual(
    recorded[0]?.map((r) => [r.id, r.outcome]),
    [
      ['a', 'sent'],
      ['b', 'gone'],
    ],
  );
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://app.example.test');
});

Deno.test('push-test: sem token ou com token inválido responde 401', async () => {
  const { value } = deps();
  assert.equal((await handlePushTest(post(), value)).status, 401);
  const bad = await handlePushTest(post('Bearer outro'), value);
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).error.code, 'UNAUTHORIZED');
});

Deno.test('push-test: sem VAPID configurado responde UPSTREAM_UNAVAILABLE', async () => {
  const { value } = deps({ vapid: null });
  const response = await handlePushTest(post('Bearer ok'), value);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'UPSTREAM_UNAVAILABLE');
});

Deno.test('push-test: preflight e método errado', async () => {
  const { value } = deps();
  const options = await handlePushTest(
    new Request('https://fn.example.test/push-test', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example.test' },
    }),
    value,
  );
  assert.equal(options.status, 204);
  const get = await handlePushTest(
    new Request('https://fn.example.test/push-test', { headers: { Authorization: 'Bearer ok' } }),
    value,
  );
  assert.equal(get.status, 405);
});

Deno.test('push-test: sem inscrição ativa devolve sent 0', async () => {
  const { value } = deps({ subscriptions: () => Promise.resolve([]) });
  assert.deepEqual(await (await handlePushTest(post('Bearer ok'), value)).json(), { sent: 0 });
});
