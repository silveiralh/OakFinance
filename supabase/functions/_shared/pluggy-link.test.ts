// T-073: `pluggy-connect-token` e `pluggy-link-item` contra o mock da Pluggy (US-45, RN-79; tech §6.1.3).
import assert from 'node:assert/strict';
import { createState, handle } from '../../../scripts/mock-pluggy.ts';
import { PluggyConnector } from './connectors/pluggy/client.ts';
import { RATE_LIMITS } from './pluggy-functions.ts';
import {
  type ConnectionRef,
  type ExternalAccountRef,
  handleConnectToken,
  handleLinkItem,
  type LinkStore,
  type PluggyDeps,
} from './pluggy-link.ts';

const USER_A = '00000000-0000-7000-8000-00000000000a';
const USER_B = '00000000-0000-7000-8000-00000000000b';
const ORIGIN = 'https://app.example.test';

class MemoryStore implements LinkStore {
  connections: Record<string, unknown>[] = [];
  accounts: Record<string, unknown>[] = [];
  connectionByItem(itemId: string): Promise<ConnectionRef | null> {
    const row = this.connections.find((c) => c.external_item_id === itemId);
    return Promise.resolve(row ? { id: String(row.id), user_id: String(row.user_id) } : null);
  }
  saveConnection(row: Record<string, unknown>): Promise<void> {
    this.connections = [...this.connections.filter((c) => c.id !== row.id), row];
    return Promise.resolve();
  }
  externalAccounts(ids: readonly string[]): Promise<ExternalAccountRef[]> {
    return Promise.resolve(
      this.accounts
        .filter((a) => ids.includes(String(a.external_account_id)))
        .map((a) => ({
          id: String(a.id),
          user_id: String(a.user_id),
          external_account_id: String(a.external_account_id),
          account_id: (a.account_id as string | undefined) ?? null,
          card_id: (a.card_id as string | undefined) ?? null,
          is_ignored: Boolean(a.is_ignored),
        })),
    );
  }
  saveExternalAccounts(rows: readonly Record<string, unknown>[]): Promise<void> {
    for (const row of rows) {
      const before = this.accounts.find((a) => a.id === row.id);
      this.accounts = [...this.accounts.filter((a) => a.id !== row.id), { ...before, ...row }];
    }
    return Promise.resolve();
  }
}

function setup(overrides: Partial<PluggyDeps> = {}) {
  const state = createState(50);
  const store = new MemoryStore();
  const hits = new Map<string, number>();
  let n = 0;
  const connector = new PluggyConnector({
    baseUrl: 'http://mock.test',
    clientId: 'id',
    clientSecret: 'segredo',
    allowedConnectorIds: [200],
    webhookUrl: null,
    fetch: (input, init) => handle(new Request(input, init), state),
  });
  const deps: PluggyDeps = {
    cors: { appOrigin: ORIGIN },
    caller: (authorization) => {
      const userId = { 'Bearer token-a': USER_A, 'Bearer token-b': USER_B }[authorization];
      return Promise.resolve(
        userId
          ? {
              userId,
              hit: (bucket, limit) => {
                const key = `${userId}:${bucket}`;
                hits.set(key, (hits.get(key) ?? 0) + 1);
                return Promise.resolve((hits.get(key) ?? 0) <= limit);
              },
            }
          : null,
      );
    },
    connector: () => connector,
    allowedConnectorIds: [200],
    store,
    newId: () => `id-${++n}`,
    now: () => new Date('2026-11-07T12:00:00.000Z'),
    ...overrides,
  };
  return { deps, store, state, hits };
}

function post(body: unknown, token = 'token-a', method = 'POST'): Request {
  return new Request('http://fn.test/pluggy-link-item', {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      origin: ORIGIN,
      'content-type': 'application/json',
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

async function read(
  response: Response,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

Deno.test('US-45: connect token para o usuário da sessão, com os conectores permitidos', async () => {
  const { deps } = setup();
  const { status, body } = await read(await handleConnectToken(post({}), deps));
  assert.equal(status, 200);
  assert.deepEqual(body, {
    connectToken: 'mock-connect-token',
    connectorIds: [200],
    expiresAt: body.expiresAt,
  });
  assert.match(String(body.expiresAt), /^\d{4}-\d{2}-\d{2}T/);
});

Deno.test('US-45: renovar exige que a conexão seja do usuário', async () => {
  const { deps, store } = setup();
  await store.saveConnection({ id: 'c1', user_id: USER_B, external_item_id: 'item-nubank' });
  assert.equal((await handleConnectToken(post({ itemId: 'item-nubank' }), deps)).status, 404);
  await store.saveConnection({ id: 'c1', user_id: USER_A, external_item_id: 'item-nubank' });
  assert.equal((await handleConnectToken(post({ itemId: 'item-nubank' }), deps)).status, 200);
  assert.equal((await handleConnectToken(post({ itemId: 'item-desconhecido' }), deps)).status, 404);
});

Deno.test('US-45: vincular valida o item, grava conexão e contas e devolve o mapeamento', async () => {
  const { deps, store } = setup();
  const { status, body } = await read(await handleLinkItem(post({ itemId: 'item-nubank' }), deps));
  assert.equal(status, 200);
  assert.equal(body.connectionId, 'id-1');
  assert.equal(body.status, 'UPDATED');
  assert.deepEqual(body.accounts, [
    {
      id: 'id-2',
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      name: 'Conta exemplo',
      numberMasked: '0002',
      accountId: null,
      cardId: null,
      isIgnored: false,
      suggestion: null,
    },
    {
      id: 'id-3',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      name: 'Cartão exemplo',
      numberMasked: '0000',
      accountId: null,
      cardId: null,
      isIgnored: false,
      suggestion: { closingDay: 3, dueDay: 10, limitCents: 500000 },
    },
  ]);
  assert.equal(store.connections.length, 1);
  assert.deepEqual(
    [
      store.connections[0]?.user_id,
      store.connections[0]?.external_item_id,
      store.connections[0]?.device_id,
    ],
    [USER_A, 'item-nubank', 'server:pluggy'],
  );
  assert.ok(store.accounts.every((a) => a.user_id === USER_A && a.connection_id === 'id-1'));
  // vincular de novo: mesmos ids e o mapeamento do usuário preservado
  const card = store.accounts.find((a) => a.external_account_id === 'acc-nu-card');
  if (card) {
    card.card_id = 'meu-cartao';
  }
  const again = await read(await handleLinkItem(post({ itemId: 'item-nubank' }), deps));
  assert.equal(again.body.connectionId, 'id-1');
  const accounts = again.body.accounts as Array<{ id: string; cardId: string | null }>;
  assert.deepEqual(
    accounts.map((a) => [a.id, a.cardId]),
    [
      ['id-2', null],
      ['id-3', 'meu-cartao'],
    ],
  );
  assert.equal(store.accounts.find((a) => a.id === 'id-3')?.card_id, 'meu-cartao');
  assert.equal(store.accounts.length, 2);
});

Deno.test('US-45: item da Demo (sem clientUserId) ganha o usuário da sessão', async () => {
  const { deps, state } = setup();
  assert.equal((await handleLinkItem(post({ itemId: 'item-bb' }), deps)).status, 200);
  assert.equal(state.items.get('item-bb')?.clientUserId, USER_A);
});

Deno.test('US-45: Item ID inexistente mostra a mensagem e nada é salvo', async () => {
  const { deps, store } = setup();
  for (const itemId of ['item-que-nao-existe', 'código com espaço', 42]) {
    const { status, body } = await read(await handleLinkItem(post({ itemId }), deps));
    assert.equal(status, 404);
    assert.deepEqual(body, {
      error: {
        code: 'ITEM_NOT_FOUND',
        message: 'Não encontramos essa conexão no Meu Pluggy. Confira o código.',
      },
    });
  }
  assert.equal(store.connections.length, 0);
  assert.equal(store.accounts.length, 0);
  assert.equal((await handleLinkItem(post({}), deps)).status, 400);
});

Deno.test('RN-79: item de outro usuário é recusado (no banco ou na Pluggy)', async () => {
  const { deps, store } = setup();
  assert.equal((await handleLinkItem(post({ itemId: 'item-nubank' }), deps)).status, 200);
  const other = await read(await handleLinkItem(post({ itemId: 'item-nubank' }, 'token-b'), deps));
  assert.equal(other.status, 409);
  assert.equal((other.body.error as { code: string }).code, 'ITEM_FOREIGN');
  // na Pluggy o item é de A, e o banco ainda não sabe
  const fresh = setup();
  const b = await read(
    await handleLinkItem(post({ itemId: 'item-nubank' }, 'token-b'), fresh.deps),
  );
  assert.equal((b.body.error as { code: string }).code, 'ITEM_FOREIGN');
  assert.equal(fresh.store.connections.length, 0);
  assert.equal(store.connections.length, 1);
});

Deno.test('RN-79: só o conector permitido (MeuPluggy) é aceito', async () => {
  const { deps, store } = setup({ allowedConnectorIds: [999] });
  const { status, body } = await read(await handleLinkItem(post({ itemId: 'item-nubank' }), deps));
  assert.equal(status, 403);
  assert.equal((body.error as { code: string }).code, 'CONNECTOR_NOT_ALLOWED');
  assert.equal(store.connections.length, 0);
  const none = setup({ allowedConnectorIds: [] });
  assert.equal((await handleLinkItem(post({ itemId: 'item-nubank' }), none.deps)).status, 403);
});

Deno.test('tech §6.0: auth, método, CORS, rate limit e segredos ausentes', async () => {
  const { deps } = setup();
  assert.equal(
    (await handleLinkItem(post({ itemId: 'item-nubank' }, 'invalido'), deps)).status,
    401,
  );
  const noAuth = new Request('http://fn.test/x', {
    method: 'POST',
    body: '{}',
    headers: { origin: ORIGIN },
  });
  assert.equal((await handleConnectToken(noAuth, deps)).status, 401);
  assert.equal((await handleLinkItem(post(null, 'token-a', 'GET'), deps)).status, 405);
  assert.equal((await handleConnectToken(post(null, 'token-a', 'GET'), deps)).status, 405);
  const options = new Request('http://fn.test/x', {
    method: 'OPTIONS',
    headers: { origin: ORIGIN },
  });
  const pre = await handleLinkItem(options, deps);
  assert.ok(pre.status < 300);
  assert.equal(pre.headers.get('access-control-allow-origin'), ORIGIN);
  assert.ok((await handleConnectToken(options, deps)).status < 300);
  const bad = new Request('http://fn.test/x', {
    method: 'POST',
    body: 'não é json',
    headers: { Authorization: 'Bearer token-a', origin: ORIGIN },
  });
  assert.equal((await handleLinkItem(bad, deps)).status, 400);

  const limited = setup();
  for (let i = 0; i < RATE_LIMITS['pluggy-connect']; i += 1) {
    assert.equal((await handleConnectToken(post({}), limited.deps)).status, 200);
  }
  assert.equal((await handleConnectToken(post({}), limited.deps)).status, 429);
  // outro usuário não é afetado
  assert.equal((await handleConnectToken(post({}, 'token-b'), limited.deps)).status, 200);

  const unconfigured = setup({
    connector: () => {
      throw new Error('sem segredos');
    },
  });
  const res = await read(await handleLinkItem(post({ itemId: 'item-nubank' }), unconfigured.deps));
  assert.equal(res.status, 502);
  assert.equal((await handleConnectToken(post({}), unconfigured.deps)).status, 502);
});

Deno.test('erros da Pluggy viram códigos estáveis (indisponível, limite)', async () => {
  for (const [status, expected] of [
    [503, 502],
    [429, 429],
  ] as const) {
    const { deps } = setup({
      connector: () =>
        new PluggyConnector({
          baseUrl: 'http://mock.test',
          clientId: 'a',
          clientSecret: 'b',
          allowedConnectorIds: [200],
          webhookUrl: null,
          fetch: (input) =>
            Promise.resolve(
              new URL(new Request(input).url).pathname === '/auth'
                ? Response.json({ apiKey: 'k' })
                : new Response('{}', { status }),
            ),
        }),
    });
    assert.equal((await handleLinkItem(post({ itemId: 'item-nubank' }), deps)).status, expected);
    assert.equal((await handleConnectToken(post({}), deps)).status, expected);
  }
  // erro que não é do provedor: INTERNAL
  const broken = setup();
  broken.deps.store.connectionByItem = () => Promise.reject(new Error('banco fora'));
  assert.equal((await handleLinkItem(post({ itemId: 'item-nubank' }), broken.deps)).status, 500);
});
