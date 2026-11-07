// T-088: `nfce-fetch` (tech §6.2.3; RN-82, RN-84, D-005): allowlist anti-SSRF, URL reconstruída, redirects, timeout,
// 2 MB, nova tentativa, rate limit e fallback. A chave de acesso (DV válido) é gerada aqui, nunca versionada.
import assert from 'node:assert/strict';
import { accessKeyCheckDigit, parseNfceQr } from './domain/index.ts';
import {
  fetchNfce,
  handleNfceFetch,
  isAllowedNfceHost,
  NFCE_BASE_URL,
  NFCE_MAX_BYTES,
  type NfceDeps,
  nfceBaseUrl,
  rebuildNfceUrl,
} from './nfce-fetch.ts';
import { RATE_LIMITS } from './pluggy-functions.ts';

const ORIGIN = 'https://app.example.test';
const USER = '00000000-0000-7000-8000-00000000000a';
const PAGE = await Deno.readTextFile(
  new URL('../../../packages/nfce-parser/test/fixtures/sintetica-completa.html', import.meta.url),
);
const CAPTCHA = await Deno.readTextFile(
  new URL('../../../packages/nfce-parser/test/fixtures/sintetica-captcha.html', import.meta.url),
);

/** Chave fictícia: UF, AAMM 2611, CNPJ de zeros, modelo 65, série, número, tipo e código; DV calculado. */
function key(uf = '41'): string {
  const first = `${uf}2611${'0'.repeat(14)}65001000000123100000001`;
  return `${first}${accessKeyCheckDigit(first)}`;
}

function qrUrl(uf = '41', host = 'www.fazenda.pr.gov.br'): string {
  return `http://${host}/nfce/qrcode?p=${key(uf)}|2|1|1|ABCDEF0123456789`;
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function setup(handler: Handler, overrides: Partial<NfceDeps> = {}) {
  const calls: string[] = [];
  let hits = 0;
  const deps: NfceDeps = {
    cors: { appOrigin: ORIGIN },
    caller: (authorization) =>
      Promise.resolve(
        authorization === 'Bearer token-a'
          ? {
              userId: USER,
              hit: (_bucket, limit) => {
                hits += 1;
                return Promise.resolve(hits <= limit);
              },
            }
          : null,
      ),
    fetch: (input, init) => {
      const url = String(input);
      calls.push(url);
      return Promise.resolve(handler(url, init ?? {}));
    },
    baseUrl: NFCE_BASE_URL,
    ...overrides,
  };
  return { deps, calls };
}

function post(body: unknown, authorization = 'Bearer token-a'): Request {
  return new Request('http://localhost/nfce-fetch', {
    method: 'POST',
    headers: { Authorization: authorization, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const html = (text: string, status = 200) =>
  new Response(text, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

Deno.test('RN-82: busca a página reconstruída na SEFAZ-PR e devolve os itens', async () => {
  const { deps, calls } = setup(() => html(PAGE));
  const response = await handleNfceFetch(post({ qr: qrUrl() }), deps);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'full');
  assert.equal(body.qr.accessKey, key());
  assert.equal(body.receipt.totalCents, 106500);
  assert.equal(body.receipt.items.length, 3);
  assert.equal(body.errorCode, undefined);
  // https, host fixo, caminho fixo e só o p validado
  assert.deepEqual(calls, [
    `https://www.fazenda.pr.gov.br/nfce/qrcode?p=${encodeURIComponent(`${key()}|2|1|1|ABCDEF0123456789`)}`,
  ]);
});

Deno.test('RN-84: UF diferente de 41 volta fallback sem buscar nada', async () => {
  const { deps, calls } = setup(() => html(PAGE));
  const body = await (
    await handleNfceFetch(post({ qr: qrUrl('35', 'www.nfce.fazenda.sp.gov.br') }), deps)
  ).json();
  assert.deepEqual(
    [body.status, body.errorCode, body.receipt, body.qr.uf],
    ['fallback', 'NFCE_UNAVAILABLE', null, '35'],
  );
  assert.equal(calls.length, 0);
});

Deno.test('tech §6.2.3: anti-SSRF — host fora da allowlist não é buscado', async () => {
  for (const host of [
    'evil.example.test',
    'fazenda.pr.gov.br.example.test',
    'outra.fazenda.pr.gov.br',
    '127.0.0.1',
  ]) {
    const { deps, calls } = setup(() => html(PAGE));
    const body = await (await handleNfceFetch(post({ qr: qrUrl('41', host) }), deps)).json();
    assert.equal(body.status, 'fallback', host);
    assert.equal(calls.length, 0, host);
  }
  assert.equal(isAllowedNfceHost('https://fazenda.pr.gov.br/x'), true);
  assert.equal(isAllowedNfceHost('ftp://fazenda.pr.gov.br/x'), false);
  assert.equal(isAllowedNfceHost('nada'), false);
  // o p reconstruído não carrega nada além da chave e dos campos do QR
  const qr = parseNfceQr(qrUrl());
  assert.equal(rebuildNfceUrl({ ...qr, url: `${qrUrl()}%0d%0aHost:x` }, NFCE_BASE_URL), null);
  assert.equal(rebuildNfceUrl({ ...qr, accessKey: key('35') }, NFCE_BASE_URL), null);
});

Deno.test('tech §6.2.3: redirect só dentro da allowlist e no máximo 3', async () => {
  const inside = setup((url) =>
    url.includes('/nfce/qrcode')
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://fazenda.pr.gov.br/nfce/consulta' },
        })
      : html(PAGE),
  );
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), inside.deps)).status, 'full');
  assert.equal(inside.calls.at(-1), 'https://fazenda.pr.gov.br/nfce/consulta');

  const outside = setup(
    () =>
      new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest' } }),
  );
  const out = await fetchNfce(parseNfceQr(qrUrl()), outside.deps);
  assert.deepEqual([out.status, out.errorCode], ['fallback', 'NFCE_UNAVAILABLE']);
  assert.ok(outside.calls.every((u) => !u.includes('169.254')));

  const loop = setup(
    (url) => new Response(null, { status: 302, headers: { location: `${url}&x=1` } }),
  );
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), loop.deps)).status, 'fallback');
  // 4 requisições por tentativa (a original + 3 redirects), sem nova tentativa além da segunda
  assert.equal(loop.calls.length, 8);

  const noLocation = setup(() => new Response(null, { status: 302 }));
  assert.equal(
    (await fetchNfce(parseNfceQr(qrUrl()), noLocation.deps)).errorCode,
    'NFCE_UNAVAILABLE',
  );
});

Deno.test('D-005: 5xx tem uma nova tentativa; depois vira NFCE_UNAVAILABLE', async () => {
  let n = 0;
  const recovers = setup(() => (++n === 1 ? html('erro', 503) : html(PAGE)));
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), recovers.deps)).status, 'full');
  assert.equal(recovers.calls.length, 2);

  const down = setup(() => html('erro', 500));
  const body = await fetchNfce(parseNfceQr(qrUrl()), down.deps);
  assert.deepEqual([body.status, body.errorCode], ['fallback', 'NFCE_UNAVAILABLE']);
  assert.equal(down.calls.length, 2);

  const network = setup(() => {
    throw new TypeError('rede');
  });
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), network.deps)).errorCode, 'NFCE_UNAVAILABLE');
});

Deno.test('D-005: timeout vira NFCE_TIMEOUT depois de duas tentativas', async () => {
  const { deps, calls } = setup(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('abort', 'AbortError')),
        );
      }),
    { timeoutMs: 5 },
  );
  const body = await fetchNfce(parseNfceQr(qrUrl()), deps);
  assert.deepEqual([body.status, body.errorCode], ['fallback', 'NFCE_TIMEOUT']);
  assert.equal(calls.length, 2);
});

Deno.test('tech §6.2.3: corpo acima de 2 MB não é lido', async () => {
  const big = setup(() => html('x'.repeat(NFCE_MAX_BYTES + 1)));
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), big.deps)).errorCode, 'NFCE_UNAVAILABLE');
  const declared = setup(
    () => new Response('x', { headers: { 'content-length': String(NFCE_MAX_BYTES + 1) } }),
  );
  assert.equal(
    (await fetchNfce(parseNfceQr(qrUrl()), declared.deps)).errorCode,
    'NFCE_UNAVAILABLE',
  );
});

Deno.test('RN-84: captcha e layout desconhecido viram fallback com o código do parser', async () => {
  const captcha = setup(() => html(CAPTCHA));
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), captcha.deps)).errorCode, 'NFCE_CAPTCHA');
  const layout = setup(() => html('<html><body>outra coisa</body></html>'));
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), layout.deps)).errorCode, 'NFCE_LAYOUT');
  // charset ISO-8859-1 é respeitado
  const latin = setup(
    () =>
      new Response(new TextEncoder().encode(PAGE), {
        headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      }),
  );
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), latin.deps)).status, 'full');
  const unknown = setup(
    () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=nao-existe' } }),
  );
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), unknown.deps)).status, 'full');
});

Deno.test('tech §6.2.3: QR inválido é 400, sem token é 401, GET é 405 e passa de 30/h é 429', async () => {
  const { deps } = setup(() => html(PAGE));
  const bad = await handleNfceFetch(post({ qr: 'não é QR' }), deps);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'BAD_REQUEST');
  const wrongDv = qrUrl().replace(key(), `${key().slice(0, 43)}${(Number(key()[43]) + 1) % 10}`);
  assert.equal((await handleNfceFetch(post({ qr: wrongDv }), deps)).status, 400);
  assert.equal((await handleNfceFetch(post({}), deps)).status, 400);
  assert.equal((await handleNfceFetch(post({ qr: qrUrl() }, 'Bearer outro'), deps)).status, 401);
  assert.equal(
    (await handleNfceFetch(new Request('http://localhost/nfce-fetch', { method: 'GET' }), deps))
      .status,
    405,
  );
  const options = await handleNfceFetch(
    new Request('http://localhost/nfce-fetch', { method: 'OPTIONS', headers: { Origin: ORIGIN } }),
    deps,
  );
  assert.ok(options.status < 300);
  assert.equal(RATE_LIMITS['nfce-fetch'], 30);
  const limited = setup(() => html(PAGE));
  let last = 0;
  for (let i = 0; i <= RATE_LIMITS['nfce-fetch']; i += 1) {
    last = (await handleNfceFetch(post({ qr: qrUrl() }), limited.deps)).status;
  }
  assert.equal(last, 429);
});

Deno.test('tech §6.2.3: NFCE_TEST_BASE_URL só vale com APP_ENV=local', async () => {
  const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
  assert.equal(nfceBaseUrl(env({ NFCE_TEST_BASE_URL: 'http://127.0.0.1:54401/' })), NFCE_BASE_URL);
  assert.equal(
    nfceBaseUrl(env({ APP_ENV: 'production', NFCE_TEST_BASE_URL: 'http://127.0.0.1:54401' })),
    NFCE_BASE_URL,
  );
  const local = nfceBaseUrl(
    env({ APP_ENV: 'local', NFCE_TEST_BASE_URL: 'http://127.0.0.1:54401/' }),
  );
  assert.equal(local, 'http://127.0.0.1:54401');
  const { deps, calls } = setup(() => html(PAGE), { baseUrl: local });
  assert.equal((await fetchNfce(parseNfceQr(qrUrl()), deps)).status, 'full');
  assert.ok(calls[0]?.startsWith('http://127.0.0.1:54401/nfce/qrcode?p='));
});
