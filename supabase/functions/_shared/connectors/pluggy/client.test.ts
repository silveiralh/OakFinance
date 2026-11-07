// T-072: cliente da Pluggy contra o mock (`scripts/mock-pluggy.ts`) e mapeamento para os tipos neutros
// (US-45, RN-79; tech §6.1.1, §6.1.2 e §6.1.6). Fixtures PROVISÓRIAS e sintéticas.
import assert from 'node:assert/strict';
import { createState, handle, MOCK_API_KEY } from '../../../../../scripts/mock-pluggy.ts';
import { ProviderError, type ProviderTransaction } from '../types.ts';
import {
  API_KEY_TTL_MS,
  PLUGGY_API_URL,
  type PluggyConfig,
  PluggyConnector,
  pluggyConfigFromEnv,
} from './client.ts';
import {
  calendarDate,
  mapAccount,
  mapTransaction,
  maskNumber,
  saoPauloDate,
  toCents,
} from './map.ts';

interface Call {
  method: string;
  path: string;
  apiKey: string | null;
  body: unknown;
}

function setup(
  options: { pageSize?: number; now?: () => number; config?: Partial<PluggyConfig> } = {},
) {
  const state = createState(options.pageSize ?? 2);
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = request.body ? await request.clone().text() : '';
    calls.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      apiKey: request.headers.get('x-api-key'),
      body: text ? JSON.parse(text) : undefined,
    });
    return handle(request, state);
  };
  const connector = new PluggyConnector({
    baseUrl: 'http://mock.test',
    clientId: 'client-id-teste',
    clientSecret: 'client-secret-teste',
    allowedConnectorIds: [200],
    webhookUrl: 'http://fn.test/functions/v1/pluggy-webhook?t=token-teste',
    fetch: fetcher,
    ...(options.now ? { now: options.now } : {}),
    ...options.config,
  });
  return { connector, calls, state };
}

async function all(
  iterable: AsyncIterable<ProviderTransaction[]>,
): Promise<ProviderTransaction[][]> {
  const pages: ProviderTransaction[][] = [];
  for await (const page of iterable) {
    pages.push(page);
  }
  return pages;
}

Deno.test('RN-79: segredos só do ambiente do servidor; PLUGGY_API_URL só com APP_ENV=local', () => {
  const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] });
  const base = {
    PLUGGY_CLIENT_ID: 'id',
    PLUGGY_CLIENT_SECRET: 'segredo',
    PLUGGY_ALLOWED_CONNECTOR_IDS: '200, 0, x,201',
    PLUGGY_WEBHOOK_TOKEN: 't k',
    SUPABASE_URL: 'https://projeto.supabase.co/',
    PLUGGY_API_URL: 'http://127.0.0.1:54400',
  };
  const prod = pluggyConfigFromEnv(env(base));
  assert.equal(prod.baseUrl, PLUGGY_API_URL);
  assert.deepEqual(prod.allowedConnectorIds, [200, 201]);
  assert.equal(prod.webhookUrl, 'https://projeto.supabase.co/functions/v1/pluggy-webhook?t=t%20k');
  assert.equal(
    pluggyConfigFromEnv(env({ ...base, APP_ENV: 'local' })).baseUrl,
    'http://127.0.0.1:54400',
  );
  const { PLUGGY_WEBHOOK_TOKEN: _t, ...noToken } = base;
  assert.equal(pluggyConfigFromEnv(env(noToken)).webhookUrl, null);
  const { PLUGGY_CLIENT_SECRET: _s, ...noSecret } = base;
  assert.throws(() => pluggyConfigFromEnv(env(noSecret)), ProviderError);
});

Deno.test('US-45: connect token com clientUserId, webhook e avoidDuplicates dentro de options', async () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z');
  const { connector, calls } = setup({ now: () => now });
  const token = await connector.createConnectToken({ userId: 'u-1' });
  assert.deepEqual(token, {
    token: 'mock-connect-token',
    connectorIds: [200],
    expiresAt: '2026-11-07T12:30:00.000Z',
  });
  assert.deepEqual(
    calls.map((c) => [c.method, c.path, c.apiKey]),
    [
      ['POST', '/auth', null],
      ['POST', '/connect_token', MOCK_API_KEY],
    ],
  );
  assert.deepEqual(calls[0]?.body, {
    clientId: 'client-id-teste',
    clientSecret: 'client-secret-teste',
  });
  assert.deepEqual(calls[1]?.body, {
    options: {
      clientUserId: 'u-1',
      webhookUrl: 'http://fn.test/functions/v1/pluggy-webhook?t=token-teste',
      avoidDuplicates: true,
    },
  });
  // renovação: itemId na raiz
  await connector.createConnectToken({ userId: 'u-1', itemId: 'item-nubank' });
  assert.equal((calls.at(-1)?.body as { itemId?: string } | undefined)?.itemId, 'item-nubank');
  // o apiKey é reaproveitado (um só /auth)
  assert.equal(calls.filter((c) => c.path === '/auth').length, 1);
});

Deno.test('tech §6.1.1: o apiKey vale 2 h; depois, ou num 401, um /auth novo', async () => {
  let now = 0;
  const { connector, calls, state } = setup({ now: () => now });
  await connector.getItem('item-bb');
  now = API_KEY_TTL_MS + 1;
  await connector.getItem('item-bb');
  assert.equal(calls.filter((c) => c.path === '/auth').length, 2);
  // 401 na chamada: renova uma vez e repete
  let first = true;
  const flaky = new PluggyConnector({
    baseUrl: 'http://mock.test',
    clientId: 'a',
    clientSecret: 'b',
    allowedConnectorIds: [],
    webhookUrl: null,
    fetch: (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.startsWith('/items/') && first) {
        first = false;
        return Promise.resolve(new Response('{}', { status: 401 }));
      }
      return handle(request, state);
    },
  });
  assert.equal((await flaky.getItem('item-bb')).id, 'item-bb');
});

Deno.test('US-45: item validado (status, clientUserId nulo da Demo, LOGIN_ERROR) e Item ID inexistente', async () => {
  const { connector } = setup();
  assert.deepEqual(await connector.getItem('item-bb'), {
    id: 'item-bb',
    connectorId: 200,
    connectorName: 'MeuPluggy',
    status: 'UPDATED',
    executionStatus: 'SUCCESS',
    clientUserId: null,
    consentExpiresAt: null,
    updatedAt: '2026-11-06T10:00:00.000Z',
  });
  const broken = await connector.getItem('item-login-error');
  assert.equal(broken.status, 'LOGIN_ERROR');
  assert.equal(broken.executionStatus, 'USER_AUTHORIZATION_REVOKED');
  await connector.setClientUserId('item-bb', 'u-1');
  assert.equal((await connector.getItem('item-bb')).clientUserId, 'u-1');
  await assert.rejects(connector.getItem('nao-existe'), (e: unknown) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.code, 'ITEM_NOT_FOUND');
    return true;
  });
});

Deno.test('US-45: contas do item com tipo, cartão com fechamento, vencimento e limite em centavos', async () => {
  const { connector } = setup();
  const accounts = await connector.listAccounts('item-nubank');
  assert.deepEqual(
    accounts.map((a) => [a.id, a.type, a.subtype, a.numberMasked, a.balanceCents]),
    [
      ['acc-nu-cc', 'BANK', 'CHECKING_ACCOUNT', '0002', -1050],
      ['acc-nu-card', 'CREDIT', 'CREDIT_CARD', '0000', 90000],
    ],
  );
  assert.deepEqual(accounts[1]?.credit, {
    closeDate: '2026-11-03',
    dueDate: '2026-11-10',
    limitCents: 500000,
    availableLimitCents: 410000,
    minimumPaymentCents: 13500,
  });
  assert.equal(accounts[0]?.credit, null);
});

Deno.test('tech §6.1.1: transações só pelo /v2/transactions, seguindo o cursor next', async () => {
  const { connector, calls } = setup({ pageSize: 2 });
  const pages = await all(connector.listTransactions('acc-nu-card', { dateFrom: '2026-10-01' }));
  assert.deepEqual(
    pages.map((p) => p.length),
    [2, 2, 1],
  );
  assert.deepEqual(
    pages.flat().map((t) => t.id),
    ['tx-nu-001', 'tx-nu-002', 'tx-nu-003', 'tx-nu-004', 'tx-nu-005'],
  );
  const paths = calls.filter((c) => c.path.includes('transactions')).map((c) => c.path);
  assert.ok(paths.every((p) => p.startsWith('/v2/transactions?')));
  assert.ok(paths[1]?.includes('cursor=2'));
  // dateTo e ids
  const october = await all(
    connector.listTransactions('acc-nu-card', { dateFrom: '2026-10-01', dateTo: '2026-10-31' }),
  );
  assert.equal(october.flat().length, 3);
  const byIds = await connector.getTransactionsByIds('acc-nu-card', ['tx-nu-004', 'tx-nu-001']);
  assert.deepEqual(byIds.map((t) => t.id).sort(), ['tx-nu-001', 'tx-nu-004']);
});

Deno.test('tech §6.1.1: a transação que some volta com id novo (deleted seguido de created)', async () => {
  const { connector, state } = setup({ pageSize: 50 });
  await handle(new Request('http://mock.test/__mock/reissue', { method: 'POST' }), state);
  const ids = (await all(connector.listTransactions('acc-nu-card', { dateFrom: '2026-10-01' })))
    .flat()
    .map((t) => t.id);
  assert.ok(!ids.includes('tx-nu-005'));
  assert.ok(ids.includes('tx-nu-005b'));
});

Deno.test('US-45: faturas por página, com vencimento, total e mínimo em centavos', async () => {
  const { connector } = setup();
  assert.deepEqual(await connector.listBills('acc-nu-card'), [
    { id: 'bill-nu-2026-10', dueDate: '2026-10-10', totalCents: 64050, minimumPaymentCents: 9608 },
    { id: 'bill-nu-2026-11', dueDate: '2026-11-10', totalCents: 90000, minimumPaymentCents: 13500 },
  ]);
});

Deno.test('tech §6.1.2: PATCH pede atualização e DELETE remove o item', async () => {
  const { connector, calls } = setup();
  await connector.requestRefresh('item-nubank');
  assert.equal((await connector.getItem('item-nubank')).status, 'UPDATING');
  await connector.deleteItem('item-nubank');
  assert.deepEqual(
    calls.filter((c) => c.method !== 'GET' && c.path !== '/auth').map((c) => [c.method, c.path]),
    [
      ['PATCH', '/items/item-nubank'],
      ['DELETE', '/items/item-nubank'],
    ],
  );
  await assert.rejects(connector.getItem('item-nubank'), ProviderError);
});

Deno.test('erros do provedor viram códigos estáveis, sem a resposta crua', async () => {
  const cases: Array<[number | 'throw' | 'html', string]> = [
    [403, 'PROVIDER_AUTH'],
    [429, 'RATE_LIMITED'],
    [503, 'PROVIDER_UNAVAILABLE'],
    [400, 'PROVIDER_BAD_RESPONSE'],
    ['throw', 'PROVIDER_UNAVAILABLE'],
    ['html', 'PROVIDER_BAD_RESPONSE'],
  ];
  for (const [answer, code] of cases) {
    const connector = new PluggyConnector({
      baseUrl: 'http://mock.test',
      clientId: 'a',
      clientSecret: 'b',
      allowedConnectorIds: [],
      webhookUrl: null,
      fetch: (input, init) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === '/auth') {
          return Promise.resolve(Response.json({ apiKey: 'k' }));
        }
        if (answer === 'throw') {
          return Promise.reject(new TypeError('rede'));
        }
        if (answer === 'html') {
          return Promise.resolve(new Response('<html>', { status: 200 }));
        }
        return Promise.resolve(new Response('{"message":"detalhe"}', { status: answer }));
      },
    });
    await assert.rejects(connector.getItem('x'), (e: unknown) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.code, code);
      assert.ok(!e.message.includes('detalhe'));
      return true;
    });
  }
  // /auth sem apiKey
  const noKey = new PluggyConnector({
    baseUrl: 'http://mock.test',
    clientId: 'a',
    clientSecret: 'b',
    allowedConnectorIds: [],
    webhookUrl: null,
    fetch: () => Promise.resolve(Response.json({})),
  });
  await assert.rejects(noKey.listAccounts('x'), ProviderError);
  // credenciais vazias no mock → 401
  const { connector } = setup({ config: { clientSecret: '' } });
  await assert.rejects(connector.getItem('item-bb'), ProviderError);
});

Deno.test('tech §6.1.6: DEBIT/CREDIT pelo type, com valor absoluto em centavos, nos dois sinais', () => {
  const base = { accountId: 'a', date: '2026-10-05T03:00:00.000Z' };
  const out1 = mapTransaction({ ...base, id: '1', amount: -45.9, type: 'DEBIT' });
  const out2 = mapTransaction({ ...base, id: '2', amount: 45.9, type: 'DEBIT' });
  const in1 = mapTransaction({ ...base, id: '3', amount: 5000, type: 'CREDIT' });
  const in2 = mapTransaction({ ...base, id: '4', amount: -30, type: 'CREDIT' });
  assert.deepEqual(
    [out1, out2, in1, in2].map((t) => [t.direction, t.amountCents]),
    [
      ['out', 4590],
      ['out', 4590],
      ['in', 500000],
      ['in', 3000],
    ],
  );
  assert.throws(() => mapTransaction({ ...base, id: '5', amount: 0, type: 'DEBIT' }));
  assert.throws(() => mapTransaction({ ...base, id: '6', amount: 1, type: 'OUTRO' }));
});

Deno.test('tech §6.1.6: data em São Paulo, status, parcela, billId, categoria, meio e comerciante', () => {
  const card = mapTransaction({
    id: 'c',
    accountId: 'a',
    date: '2026-11-08T02:30:00.000Z',
    description: 'Loja Exemplo 2/10',
    amount: 120,
    type: 'DEBIT',
    status: 'PENDING',
    category: 'Shopping',
    creditCardMetadata: { installmentNumber: 2, totalInstallments: 10, billId: 'bill-1' },
    merchant: { name: null, businessName: 'Loja Exemplo Ltda', cnpj: '12.345.678/0001-00' },
    campoNovoDaApi: { qualquer: true },
  });
  assert.equal(card.occurredOn, '2026-11-07'); // 23:30 em São Paulo
  assert.equal(card.occurredAt, '2026-11-08T02:30:00.000Z');
  assert.equal(card.status, 'pending');
  assert.deepEqual(card.installment, { n: 2, total: 10 });
  assert.equal(card.billId, 'bill-1');
  assert.equal(card.providerCategory, 'Shopping');
  assert.equal(card.merchantName, 'Loja Exemplo Ltda');
  assert.equal(card.merchantCnpj, '12345678000100');
  assert.equal(card.descriptionRaw, 'Loja Exemplo 2/10');
  const bank = mapTransaction({
    id: 'b',
    accountId: 'a',
    date: '2026-10-05T12:30:00.000Z',
    amount: -1,
    type: 'DEBIT',
    paymentData: { paymentMethod: 'PIX' },
    installmentNumber: 1,
    totalInstallments: 1,
    merchant: { cnpj: '123' },
  });
  assert.equal(bank.status, 'posted');
  assert.equal(bank.paymentMethodRaw, 'PIX');
  assert.equal(bank.installment, null); // 1/1 não é parcela
  assert.equal(bank.merchantCnpj, null);
  assert.equal(bank.description, null);
});

Deno.test('conversões: centavos, datas de calendário, máscara e conta sem crédito', () => {
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(-1234.56), -123456);
  assert.equal(calendarDate('2026-11-10T00:00:00.000Z'), '2026-11-10');
  assert.equal(calendarDate(null), null);
  assert.equal(calendarDate('ontem'), null);
  assert.equal(saoPauloDate('2026-01-01T02:59:59.000Z'), '2025-12-31');
  assert.throws(() => saoPauloDate('ontem'));
  assert.equal(maskNumber('1234-5 678901'), '8901');
  assert.equal(maskNumber(''), null);
  const account = mapAccount({ id: 'x', itemId: 'i', type: 'BANK', subtype: 'SAVINGS_ACCOUNT' });
  assert.deepEqual(
    [account.name, account.numberMasked, account.balanceCents, account.credit],
    [null, null, null, null],
  );
});

Deno.test('linha que o mapeamento recusa é contada e pulada, sem derrubar a página', async () => {
  const { connector, state } = setup({ pageSize: 50 });
  state.transactions.push({
    id: 'ruim',
    accountId: 'acc-bb-cc',
    date: '2026-10-06T00:00:00.000Z',
    amount: 0,
    type: 'DEBIT',
  });
  const txs = (
    await all(connector.listTransactions('acc-bb-cc', { dateFrom: '2026-10-01' }))
  ).flat();
  assert.equal(txs.length, 4);
  assert.equal(connector.stats.invalid, 1);
});
