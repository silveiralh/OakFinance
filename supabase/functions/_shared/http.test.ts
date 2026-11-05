import assert from 'node:assert/strict';
import { AppError } from './errors.ts';
import {
  type CorsConfig,
  corsHeaders,
  errorResponse,
  handleError,
  isAllowedOrigin,
  jsonResponse,
  LOCAL_DEV_ORIGIN,
  preflight,
  readCorsConfig,
  readJson,
} from './http.ts';

const config: CorsConfig = {
  appOrigin: 'https://oakfinance.pages.dev',
  previewOriginSuffix: '.oakfinance.pages.dev',
};

function env(values: Record<string, string>) {
  return { get: (name: string) => values[name] };
}

function req(method: string, origin?: string, body?: string): Request {
  const headers = new Headers();
  if (origin) {
    headers.set('Origin', origin);
  }
  return new Request('http://localhost/functions/v1/x', { method, headers, body: body ?? null });
}

Deno.test('readCorsConfig normaliza barra final e ponto do sufixo', () => {
  assert.deepEqual(
    readCorsConfig(
      env({ APP_ORIGIN: 'https://a.pages.dev/', APP_PREVIEW_ORIGIN_SUFFIX: 'a.pages.dev' }),
    ),
    { appOrigin: 'https://a.pages.dev', previewOriginSuffix: '.a.pages.dev' },
  );
  assert.deepEqual(readCorsConfig(env({})), {});
});

Deno.test('origens permitidas: app, preview com o sufixo e localhost:5173', () => {
  assert.equal(isAllowedOrigin('https://oakfinance.pages.dev', config), true);
  assert.equal(isAllowedOrigin('https://pr-12.oakfinance.pages.dev', config), true);
  assert.equal(isAllowedOrigin(LOCAL_DEV_ORIGIN, config), true);
});

Deno.test('origens recusadas', () => {
  for (const origin of [
    null,
    '',
    'https://evil.example.com',
    'http://pr-12.oakfinance.pages.dev',
    'https://oakfinance.pages.dev.evil.example.com',
    'https://evil-oakfinance.pages.dev',
    'https://.oakfinance.pages.dev',
    'https://pr-1.oakfinance.pages.dev/caminho',
    'não é url',
    'http://localhost:4173',
  ]) {
    assert.equal(isAllowedOrigin(origin, config), false, String(origin));
  }
  assert.equal(isAllowedOrigin('https://pr-1.oakfinance.pages.dev', {}), false);
});

Deno.test('corsHeaders só libera a origem permitida', () => {
  const ok = corsHeaders('https://oakfinance.pages.dev', config);
  assert.equal(ok.get('Access-Control-Allow-Origin'), 'https://oakfinance.pages.dev');
  assert.equal(ok.get('Vary'), 'Origin');
  const blocked = corsHeaders('https://evil.example.com', config);
  assert.equal(blocked.get('Access-Control-Allow-Origin'), null);
});

Deno.test('preflight: 204 para origem permitida, 403 para as demais, null fora de OPTIONS', async () => {
  const ok = preflight(req('OPTIONS', LOCAL_DEV_ORIGIN), config);
  assert.equal(ok?.status, 204);
  assert.equal(ok?.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  const blocked = preflight(req('OPTIONS', 'https://evil.example.com'), config);
  assert.equal(blocked?.status, 403);
  assert.deepEqual(await blocked?.json(), {
    error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origem não permitida.' },
  });
  assert.equal(preflight(req('POST', LOCAL_DEV_ORIGIN), config), null);
});

Deno.test('jsonResponse e errorResponse definem status e cabeçalhos', async () => {
  const ok = jsonResponse({ ok: true }, req('POST', LOCAL_DEV_ORIGIN), config, 201);
  assert.equal(ok.status, 201);
  assert.equal(ok.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await ok.json(), { ok: true });
  const error = errorResponse('METHOD_NOT_ALLOWED', req('GET'), config);
  assert.equal(error.status, 405);
  assert.equal((await error.json()).error.code, 'METHOD_NOT_ALLOWED');
});

Deno.test('handleError: AppError mantém o código; erro desconhecido vira INTERNAL sem detalhes', async () => {
  const known = handleError(new AppError('UNAUTHORIZED'), req('POST'), config);
  assert.equal(known.status, 401);
  const unknown = handleError(new Error('detalhe interno sensível'), req('POST'), config);
  assert.equal(unknown.status, 500);
  const body = await unknown.json();
  assert.equal(body.error.code, 'INTERNAL');
  assert.doesNotMatch(body.error.message, /sensível/);
});

Deno.test('readJson: corpo válido e corpo inválido', async () => {
  assert.deepEqual(await readJson(req('POST', undefined, '{"a":1}')), { a: 1 });
  await assert.rejects(readJson(req('POST', undefined, '{')), (error: unknown) => {
    return error instanceof AppError && error.code === 'BAD_REQUEST';
  });
});
