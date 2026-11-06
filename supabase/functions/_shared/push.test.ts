// Testes do envio de Web Push (US-38). Chaves VAPID e da inscrição geradas em tempo de execução; o "serviço de
// push" é um servidor HTTP local que devolve o status pedido.
import assert from 'node:assert/strict';
import {
  classify,
  declarativePayload,
  type PushSender,
  type PushTarget,
  sendAll,
  vapidFromEnv,
  webPushSender,
} from './push.ts';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) {
    s += String.fromCharCode(b);
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(raw), privateKey: jwk.d ?? '' };
}

async function browserKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });

Deno.test('US-38: vapidFromEnv aceita base64url de 65/32 bytes e mailto:, e recusa o resto', async () => {
  const keys = await vapidKeys();
  const ok = vapidFromEnv(
    env({
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:ops@example.test',
    }),
  );
  assert.deepEqual(ok, { ...keys, subject: 'mailto:ops@example.test' });
  assert.deepEqual(vapidFromEnv(env({})), null);
  assert.deepEqual(
    vapidFromEnv(
      env({
        VAPID_PUBLIC_KEY: keys.privateKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: 'mailto:ops@example.test',
      }),
    ),
    null,
  );
  assert.deepEqual(
    vapidFromEnv(
      env({
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: 'x',
      }),
    ),
    null,
  );
});

Deno.test('tech §6.4.3: payload declarativo com web_push 8030, URL absoluta, pt-BR e tag', () => {
  const payload = JSON.parse(
    declarativePayload(
      {
        title: 'Lembretes ativos',
        body: 'Corpo',
        navigate: '/ajustes/lembretes',
        tag: 'push-test',
        badge: 1,
      },
      'https://app.example.test/',
    ),
  );
  assert.deepEqual(payload, {
    web_push: 8030,
    notification: {
      title: 'Lembretes ativos',
      body: 'Corpo',
      navigate: 'https://app.example.test/ajustes/lembretes',
      lang: 'pt-BR',
      tag: 'push-test',
      silent: false,
      app_badge: 1,
    },
  });
  const noBadge = JSON.parse(
    declarativePayload({ title: 't', body: 'b', navigate: 'avisos', tag: 'x' }, 'https://a.test'),
  );
  assert.deepEqual(noBadge.notification.navigate, 'https://a.test/avisos');
  assert.deepEqual('app_badge' in noBadge.notification, false);
});

Deno.test('US-38: 404 e 410 desativam a inscrição; 429, 5xx e falha de rede tentam de novo', () => {
  assert.deepEqual(classify(201), 'sent');
  assert.deepEqual(classify(404), 'gone');
  assert.deepEqual(classify(410), 'gone');
  assert.deepEqual(classify(429), 'retry');
  assert.deepEqual(classify(503), 'retry');
  assert.deepEqual(classify(0), 'retry');
  assert.deepEqual(classify(400), 'error');
});

Deno.test('webPushSender cifra (aes128gcm), assina (VAPID) e envia ao endpoint com TTL, Urgency e Topic', async () => {
  const vapid = { ...(await vapidKeys()), subject: 'mailto:ops@example.test' };
  const keys = await browserKeys();
  const seen: Array<{ path: string; headers: Headers; size: number }> = [];
  const server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen() {} }, async (req) => {
    const body = new Uint8Array(await req.arrayBuffer());
    const path = new URL(req.url).pathname;
    seen.push({ path, headers: req.headers, size: body.length });
    return new Response(null, { status: path.endsWith('/gone') ? 410 : 201 });
  });
  const base = `http://127.0.0.1:${server.addr.port}`;
  try {
    const sender = webPushSender(vapid);
    const targets: PushTarget[] = [
      { id: 'a', endpoint: `${base}/push/ok`, ...keys },
      { id: 'b', endpoint: `${base}/push/gone`, ...keys },
    ];
    const payload = declarativePayload(
      { title: 'Lembretes ativos', body: 'Teste', navigate: '/', tag: 'push-test' },
      'https://app.example.test',
    );
    const results = await sendAll(targets, payload, sender, {
      topic: 'push-test',
      urgency: 'normal',
    });
    assert.deepEqual(results, [
      { id: 'a', outcome: 'sent', status: 201 },
      { id: 'b', outcome: 'gone', status: 410 },
    ]);
    const first = seen[0];
    assert.ok(first);
    assert.deepEqual(first.headers.get('content-encoding'), 'aes128gcm');
    assert.deepEqual(first.headers.get('ttl'), '43200');
    assert.deepEqual(first.headers.get('urgency'), 'normal');
    assert.deepEqual(first.headers.get('topic'), 'push-test');
    assert.match(
      first.headers.get('authorization') ?? '',
      /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/,
    );
    assert.ok(first.size > payload.length, 'o corpo vai cifrado');
  } finally {
    await server.shutdown();
  }
});

Deno.test('webPushSender devolve 0 quando a rede falha', async () => {
  const vapid = { ...(await vapidKeys()), subject: 'mailto:ops@example.test' };
  const keys = await browserKeys();
  const failing: typeof fetch = () => Promise.reject(new TypeError('rede'));
  const status = await webPushSender(vapid, failing).send(
    { id: 'x', endpoint: 'https://push.example.test/x', ...keys },
    '{}',
    { topic: 't', urgency: 'high', ttlSeconds: 60 },
  );
  assert.deepEqual(status, 0);
});

Deno.test('sendAll segue depois de um sender que lança erro', async () => {
  let calls = 0;
  const sender: PushSender = {
    send() {
      calls += 1;
      if (calls === 1) {
        throw new Error('falhou');
      }
      return Promise.resolve(201);
    },
  };
  const t = (id: string) => ({ id, endpoint: 'https://x.test', p256dh: 'p', auth: 'a' });
  const results = await sendAll([t('1'), t('2')], '{}', sender, { topic: 't', urgency: 'normal' });
  assert.deepEqual(
    results.map((r) => r.outcome),
    ['retry', 'sent'],
  );
});
