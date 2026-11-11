// T-074: `pluggy-sync` contra o mock da Pluggy (US-46; RN-19, RN-65, RN-80; tech §6.1.4). Dados sintéticos.
import assert from 'node:assert/strict';
import { createState, handle } from '../../../scripts/mock-pluggy.ts';
import { PluggyConnector } from './connectors/pluggy/client.ts';
import type { Card, Category } from './domain/index.ts';
import { invoiceId, pluggyTxId } from './domain/index.ts';
import type { InvoiceRef } from './ingest.ts';
import { RATE_LIMITS } from './pluggy-functions.ts';
import {
  type ConnectionRow,
  dateFromFor,
  type ExistingTx,
  type ExternalAccountRow,
  handlePluggySync,
  nextLastError,
  readSyncInput,
  refreshBlockedMessage,
  type SyncHandlerDeps,
  type SyncStats,
  type SyncStore,
  TEMPORARY_RETRIES,
  temporaryFailures,
} from './pluggy-sync.ts';

const USER = '00000000-0000-7000-8000-00000000000a';
const OTHER = '00000000-0000-7000-8000-00000000000b';
const CONN = 'b1000000-0000-4000-8000-000000000001';
const ACCOUNT = 'a1000000-0000-4000-8000-000000000001';
const CARD_ID = 'c1000000-0000-4000-8000-000000000001';
const ORIGIN = 'https://app.example.test';
const CARD: Card = {
  id: CARD_ID,
  closingDay: 3,
  dueDay: 10,
  closingDayRule: 'next',
  limitCents: 500000,
  paymentAccountId: null,
};
const MERCADO: Category = {
  id: 'cat-mercado',
  slug: 'mercado',
  kind: 'expense',
  bucket: 'needs',
  parentId: null,
  isSystem: false,
  feedsReserve: false,
};

type Row = Record<string, unknown>;

class MemoryStore implements SyncStore {
  connections: Array<ConnectionRow & Row> = [];
  connectionPatches: Row[] = [];
  runs: Array<{ id: number; status: string; stats?: SyncStats; error?: string }> = [];
  ext: Array<ExternalAccountRow & Row> = [];
  invoiceRows: Array<InvoiceRef & Row> = [];
  txs: Row[] = [];
  started: string | null = '2026-10-01';

  connection(id: string) {
    return Promise.resolve(this.connections.find((c) => c.id === id) ?? null);
  }
  updateConnection(id: string, userId: string, patch: Row) {
    const c = this.connections.find((x) => x.id === id && x.user_id === userId);
    if (c) {
      Object.assign(c, patch);
    }
    this.connectionPatches.push(patch);
    return Promise.resolve();
  }
  startRun() {
    const id = this.runs.length + 1;
    this.runs.push({ id, status: 'running' });
    return Promise.resolve(id);
  }
  finishRun(run: number, status: string, stats: SyncStats, error?: string) {
    const r = this.runs.find((x) => x.id === run);
    if (r) {
      Object.assign(r, { status, stats: { ...stats }, ...(error ? { error } : {}) });
    }
    return Promise.resolve();
  }
  externalAccounts(connectionId: string, userId: string) {
    return Promise.resolve(
      this.ext.filter((a) => a.connection_id === connectionId && a.user_id === userId),
    );
  }
  updateExternalAccount(id: string, userId: string, patch: Row) {
    const a = this.ext.find((x) => x.id === id && x.user_id === userId);
    if (a) {
      Object.assign(a, patch);
    }
    return Promise.resolve();
  }
  card(id: string) {
    return Promise.resolve(id === CARD_ID ? CARD : null);
  }
  invoices(cardId: string) {
    return Promise.resolve(
      this.invoiceRows.filter((i) => i.card_id === cardId).map((i) => ({ ...i })),
    );
  }
  insertInvoice(row: Row) {
    if (!this.invoiceRows.some((i) => i.id === row.id)) {
      this.invoiceRows.push({ deleted_at: null, ...row } as InvoiceRef & Row);
    }
    return Promise.resolve();
  }
  updateInvoice(id: string, _userId: string, patch: Row) {
    const i = this.invoiceRows.find((x) => x.id === id);
    if (i) {
      Object.assign(i, patch);
    }
    return Promise.resolve();
  }
  categories() {
    return Promise.resolve([MERCADO]);
  }
  rules() {
    return Promise.resolve([]);
  }
  startedOn() {
    return Promise.resolve(this.started as never);
  }
  existingTransactions(userId: string, ids: readonly string[]) {
    return Promise.resolve(
      this.txs.filter(
        (t) => t.user_id === userId && ids.includes(String(t.external_id)),
      ) as unknown as ExistingTx[],
    );
  }
  insertTransactions(rows: readonly Row[]) {
    for (const row of rows) {
      assert.ok(!this.txs.some((t) => t.id === row.id), 'id duplicado');
      if (row.card_id) {
        assert.ok(
          this.invoiceRows.some((i) => i.id === row.invoice_id),
          'item de cartão sem fatura gravada',
        );
      }
      this.txs.push({ ...row });
    }
    return Promise.resolve();
  }
  updateTransaction(id: string, userId: string, patch: Row) {
    const t = this.txs.find((x) => x.id === id && x.user_id === userId);
    if (t) {
      Object.assign(t, patch);
    }
    return Promise.resolve();
  }
}

function setup(options: { itemId?: string; now?: string; connector?: () => PluggyConnector } = {}) {
  const state = createState(2);
  const store = new MemoryStore();
  store.connections.push({
    id: CONN,
    user_id: USER,
    external_item_id: options.itemId ?? 'item-nubank',
    is_active: true,
    deleted_at: null,
    last_manual_refresh_at: null,
  });
  const base = {
    user_id: USER,
    connection_id: CONN,
    is_ignored: false,
    last_tx_date: null,
    deleted_at: null,
  };
  store.ext.push(
    { ...base, id: 'ext-cc', external_account_id: 'acc-nu-cc', account_id: ACCOUNT, card_id: null },
    {
      ...base,
      id: 'ext-card',
      external_account_id: 'acc-nu-card',
      account_id: null,
      card_id: CARD_ID,
    },
  );
  const hits = new Map<string, number>();
  let now = new Date(options.now ?? '2026-11-07T12:00:00.000Z');
  const deps: SyncHandlerDeps = {
    cors: { appOrigin: ORIGIN },
    isSecret: (request) => request.headers.get('apikey') === 'chave-secreta',
    caller: (authorization) => {
      const userId = { 'Bearer token-a': USER, 'Bearer token-b': OTHER }[authorization];
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
    connector:
      options.connector ??
      (() =>
        new PluggyConnector({
          baseUrl: 'http://mock.test',
          clientId: 'id',
          clientSecret: 'segredo',
          allowedConnectorIds: [200],
          webhookUrl: null,
          fetch: (input, init) => handle(new Request(input, init), state),
        })),
    store,
    now: () => now,
  };
  return {
    deps,
    store,
    state,
    setNow: (iso: string) => {
      now = new Date(iso);
    },
  };
}

function call(
  body: unknown,
  headers: Record<string, string> = { Authorization: 'Bearer token-a' },
) {
  return new Request('http://fn.test/pluggy-sync', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const backfill = { connectionId: CONN, mode: 'backfill', days: 90 };

Deno.test('RN-80: janela do backfill (90 dias, até 365) e do incremental (última data − 10)', () => {
  assert.equal(dateFromFor('backfill', '2026-11-07', null), '2026-08-09');
  assert.equal(dateFromFor('backfill', '2026-11-07', '2026-11-01', 400), '2025-11-07');
  assert.equal(dateFromFor('incremental', '2026-11-07', '2026-10-20'), '2026-10-10');
  // a mínima das duas: com a última data recente, ela ainda vence
  assert.equal(dateFromFor('incremental', '2026-11-07', '2026-11-06'), '2026-10-27');
  // data futura (pendente com data à frente): hoje − 10
  assert.equal(dateFromFor('incremental', '2026-11-07', '2026-11-20'), '2026-10-28');
  // sem nada importado ainda: 90 dias
  assert.equal(dateFromFor('incremental', '2026-11-07', null), '2026-08-09');
});

Deno.test('US-46: "Atualizado há 10 min. Tente de novo em 50 min."', () => {
  const now = new Date('2026-11-07T12:10:00.000Z');
  assert.equal(
    refreshBlockedMessage('2026-11-07T12:00:00.000Z', now),
    'Atualizado há 10 min. Tente de novo em 50 min.',
  );
  assert.equal(refreshBlockedMessage('2026-11-07T11:10:00.000Z', now), null);
  assert.equal(refreshBlockedMessage(null, now), null);
  assert.equal(
    refreshBlockedMessage('2026-11-07T12:09:30.000Z', now),
    'Atualizado há 0 min. Tente de novo em 60 min.',
  );
});

Deno.test('US-46: primeira sincronização busca 90 dias; o anterior ao início do uso entra revisado', async () => {
  const { deps, store } = setup();
  store.started = '2026-10-25';
  const { status, body } = await read(await handlePluggySync(call(backfill), deps));
  assert.equal(status, 200);
  assert.deepEqual(body.stats, { accounts: 2, inserted: 6, updated: 0, deleted: 0, bills: 2 });
  assert.equal(body.jobRunId, 1);
  assert.deepEqual(store.runs[0]?.status, 'ok');
  const byExt = new Map(store.txs.map((t) => [t.external_id, t]));
  assert.equal(byExt.get('tx-nu-001')?.review_state, 'ok'); // 15/10, antes de 25/10
  assert.equal(byExt.get('tx-nu-005')?.review_state, 'new');
  assert.equal(byExt.get('tx-nu-cc-001')?.review_state, 'new'); // 30/10, depois do início
  // RN-65: id determinístico por usuário e item do provedor
  assert.equal(byExt.get('tx-nu-001')?.id, pluggyTxId(USER, 'tx-nu-001'));
  assert.equal(byExt.get('tx-nu-001')?.category_source, 'none');
  assert.equal(byExt.get('tx-nu-005')?.kind, 'expense');
  assert.equal(byExt.get('tx-nu-002')?.kind, 'refund');
  assert.equal(byExt.get('tx-nu-cc-001')?.payment_method, 'pix');
  const card = store.ext.find((a) => a.id === 'ext-card');
  assert.equal(card?.last_tx_date, '2026-11-05');
  assert.ok(card?.backfill_done_at);
  assert.equal(card?.balance_cents, 90000);
  const conn = store.connections[0] as ConnectionRow & Row;
  assert.deepEqual(
    [conn.status, conn.last_error, conn.last_success_at !== undefined],
    ['UPDATED', null, true],
  );
});

Deno.test('RN-19/RN-12: faturas v5 criadas, item com billId fixado e /bills com total e mínimo', async () => {
  const { deps, store } = setup();
  await handlePluggySync(call(backfill), deps);
  const tx1 = store.txs.find((t) => t.external_id === 'tx-nu-001');
  // tx-nu-001 (15/10) tem billId da fatura que vence em 10/11 → fatura de 2026-11, fixada
  assert.equal(tx1?.invoice_id, invoiceId(CARD_ID, '2026-11'));
  assert.equal(tx1?.invoice_pinned, true);
  // tx-nu-005 (05/11) sem billId: RN-12, fecha 03/12 → fatura de 2026-12
  const tx5 = store.txs.find((t) => t.external_id === 'tx-nu-005');
  assert.equal(tx5?.invoice_id, invoiceId(CARD_ID, '2026-12'));
  assert.equal(tx5?.invoice_pinned, false);
  const nov = store.invoiceRows.find((i) => i.id === invoiceId(CARD_ID, '2026-11'));
  assert.deepEqual(
    [
      nov?.external_bill_id,
      nov?.external_total_cents,
      nov?.external_min_payment_cents,
      nov?.due_date,
    ],
    ['bill-nu-2026-11', 90000, 13500, '2026-11-10'],
  );
  const oct = store.invoiceRows.find((i) => i.id === invoiceId(CARD_ID, '2026-10'));
  assert.equal(oct?.external_total_cents, 64050);
  assert.equal(new Set(store.invoiceRows.map((i) => i.id)).size, store.invoiceRows.length);
});

Deno.test('US-46: sincronizar de novo não duplica nada e preserva a categoria do usuário', async () => {
  const { deps, store, state } = setup();
  await handlePluggySync(call(backfill), deps);
  const count = store.txs.length;
  const posto = store.txs.find((t) => t.external_id === 'tx-nu-005') as Row;
  posto.category_id = 'cat-do-usuario';
  posto.category_source = 'manual';
  posto.review_state = 'ok';
  posto.notes = 'abasteci';
  // o banco corrige o valor e confirma a compra pendente
  const remote = state.transactions.find((t) => t.id === 'tx-nu-005') as Row;
  remote.amount = 210;
  const pending = state.transactions.find((t) => t.id === 'tx-nu-004') as Row;
  pending.status = 'POSTED';
  const again = await read(
    await handlePluggySync(call({ connectionId: CONN, mode: 'incremental' }), deps),
  );
  assert.equal(again.status, 200);
  assert.equal(store.txs.length, count);
  assert.deepEqual(again.body.stats, {
    accounts: 2,
    inserted: 0,
    updated: 2,
    deleted: 0,
    bills: 2,
  });
  assert.deepEqual(
    [posto.amount_cents, posto.category_id, posto.category_source, posto.review_state, posto.notes],
    [21000, 'cat-do-usuario', 'manual', 'ok', 'abasteci'],
  );
  assert.equal(store.txs.find((t) => t.external_id === 'tx-nu-004')?.status, 'posted');
  // terceira vez sem mudança: nada atualizado
  const third = await read(
    await handlePluggySync(call({ connectionId: CONN, mode: 'incremental' }), deps),
  );
  assert.deepEqual(third.body.stats, {
    accounts: 2,
    inserted: 0,
    updated: 0,
    deleted: 0,
    bills: 2,
  });
});

Deno.test('tech §6.1.4: a fatura movida pelo usuário não volta; a transação com id novo entra como nova', async () => {
  const { deps, store, state } = setup();
  await handlePluggySync(call(backfill), deps);
  const moved = store.txs.find((t) => t.external_id === 'tx-nu-001') as Row;
  moved.invoice_id = 'fatura-escolhida';
  moved.external_meta = { ...(moved.external_meta as Row), userMovedInvoice: true };
  (state.transactions.find((t) => t.id === 'tx-nu-001') as Row).amount = 125;
  await handle(new Request('http://mock.test/__mock/reissue', { method: 'POST' }), state);
  await handlePluggySync(call(backfill), deps);
  assert.equal(moved.invoice_id, 'fatura-escolhida');
  assert.equal(moved.amount_cents, 12500);
  // o conciliador do aparelho (T-078) junta 005 e 005b; aqui só não pode quebrar
  assert.ok(store.txs.some((t) => t.external_id === 'tx-nu-005b'));
});

Deno.test('US-46: Atualizar agora duas vezes em 10 minutos', async () => {
  const { deps, store, state, setNow } = setup();
  const refresh = { connectionId: CONN, mode: 'incremental', refresh: true };
  assert.equal((await handlePluggySync(call(refresh), deps)).status, 200);
  assert.equal(state.items.get('item-nubank')?.status, 'UPDATING');
  assert.equal(store.connections[0]?.last_manual_refresh_at, '2026-11-07T12:00:00.000Z');
  setNow('2026-11-07T12:10:00.000Z');
  const second = await read(await handlePluggySync(call(refresh), deps));
  assert.equal(second.status, 429);
  assert.deepEqual(second.body.error, {
    code: 'REFRESH_TOO_SOON',
    message: 'Atualizado há 10 min. Tente de novo em 50 min.',
  });
  // sem refresh, o incremental continua liberado
  assert.equal(
    (await handlePluggySync(call({ connectionId: CONN, mode: 'incremental' }), deps)).status,
    200,
  );
});

Deno.test('tech §6.1.4: LOGIN_ERROR marca a conexão e para sem importar nem apagar', async () => {
  const { deps, store } = setup({ itemId: 'item-login-error' });
  const { status, body } = await read(await handlePluggySync(call(backfill), deps));
  assert.equal(status, 200);
  assert.deepEqual(body.stats, { accounts: 0, inserted: 0, updated: 0, deleted: 0, bills: 0 });
  assert.equal(store.txs.length, 0);
  const conn = store.connections[0] as ConnectionRow & Row;
  assert.deepEqual([conn.status, conn.last_error], ['LOGIN_ERROR', 'USER_AUTHORIZATION_REVOKED']);
  assert.deepEqual(
    [store.runs[0]?.status, store.runs[0]?.error],
    ['partial', 'USER_AUTHORIZATION_REVOKED'],
  );
});

Deno.test('contas ignoradas, sem mapeamento ou que sumiram do banco ficam de fora', async () => {
  const { deps, store } = setup();
  (store.ext[0] as Row).is_ignored = true;
  (store.ext[1] as Row).card_id = null;
  store.ext.push({
    id: 'ext-sumiu',
    user_id: USER,
    connection_id: CONN,
    external_account_id: 'acc-que-nao-existe',
    account_id: ACCOUNT,
    card_id: null,
    is_ignored: false,
    last_tx_date: null,
    deleted_at: null,
  });
  const { body } = await read(await handlePluggySync(call(backfill), deps));
  assert.deepEqual(body.stats, { accounts: 0, inserted: 0, updated: 0, deleted: 0, bills: 0 });
});

Deno.test('tech §6.0: auth do usuário ou secret, conexão alheia, entrada, rate limit e erro do provedor', async () => {
  const { deps, store } = setup();
  assert.equal((await handlePluggySync(call(backfill, {}), deps)).status, 401);
  assert.equal(
    (await handlePluggySync(call(backfill, { Authorization: 'Bearer token-b' }), deps)).status,
    404,
  );
  // pg_cron com a chave secreta: qualquer conexão ativa, sem refresh
  const secret = await read(
    await handlePluggySync(
      call({ connectionId: CONN, mode: 'incremental', refresh: true }, { apikey: 'chave-secreta' }),
      deps,
    ),
  );
  assert.equal(secret.status, 200);
  assert.equal(store.connections[0]?.last_manual_refresh_at, null);
  for (const bad of [
    {},
    { connectionId: 'x', mode: 'backfill' },
    { connectionId: CONN, mode: 'tudo' },
    { ...backfill, days: 0 },
    { ...backfill, days: 366 },
    { ...backfill, refresh: 'sim' },
  ]) {
    assert.equal((await handlePluggySync(call(bad), deps)).status, 400, JSON.stringify(bad));
  }
  assert.deepEqual(
    readSyncInput({ connectionId: CONN, mode: 'backfill', days: 30, refresh: false }),
    {
      connectionId: CONN,
      mode: 'backfill',
      days: 30,
      refresh: false,
    },
  );
  const options = new Request('http://fn.test/x', {
    method: 'OPTIONS',
    headers: { origin: ORIGIN },
  });
  assert.ok((await handlePluggySync(options, deps)).status < 300);
  const get = new Request('http://fn.test/x', { method: 'GET', headers: { origin: ORIGIN } });
  assert.equal((await handlePluggySync(get, deps)).status, 405);
  // conexão inativa
  (store.connections[0] as Row).is_active = false;
  assert.equal((await handlePluggySync(call(backfill), deps)).status, 404);
  (store.connections[0] as Row).is_active = true;

  const limited = setup();
  for (let i = 0; i < RATE_LIMITS['pluggy-sync']; i += 1) {
    assert.equal(
      (await handlePluggySync(call({ connectionId: CONN, mode: 'incremental' }), limited.deps))
        .status,
      200,
    );
  }
  assert.equal(
    (await handlePluggySync(call({ connectionId: CONN, mode: 'incremental' }), limited.deps))
      .status,
    429,
  );

  const down = setup({
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
              : new Response('{}', { status: 503 }),
          ),
      }),
  });
  const failed = await read(await handlePluggySync(call(backfill), down.deps));
  assert.equal(failed.status, 502);
  assert.deepEqual(
    [down.store.runs[0]?.status, down.store.runs[0]?.error],
    ['error', 'UPSTREAM_UNAVAILABLE'],
  );
  assert.equal((down.store.connections[0] as Row).last_error, 'UPSTREAM_UNAVAILABLE');

  const unconfigured = setup({
    connector: () => {
      throw new Error('sem segredos');
    },
  });
  assert.equal((await handlePluggySync(call(backfill), unconfigured.deps)).status, 502);
  assert.equal(unconfigured.store.runs.length, 0); // não abre job_runs (o ops_health não acusa)
});

Deno.test('RN-81: erro temporário conta as falhas para até 3 novas tentativas; outro erro não conta', () => {
  assert.equal(TEMPORARY_RETRIES, 3);
  assert.equal(nextLastError('UPSTREAM_UNAVAILABLE', null), 'UPSTREAM_UNAVAILABLE');
  assert.equal(
    nextLastError('UPSTREAM_UNAVAILABLE', 'UPSTREAM_UNAVAILABLE'),
    'UPSTREAM_UNAVAILABLE:2',
  );
  assert.equal(nextLastError('UPSTREAM_TIMEOUT', 'UPSTREAM_UNAVAILABLE:3'), 'UPSTREAM_TIMEOUT:4');
  assert.equal(nextLastError('ITEM_NOT_FOUND', 'UPSTREAM_UNAVAILABLE:2'), 'ITEM_NOT_FOUND');
  assert.equal(temporaryFailures('UPSTREAM_UNAVAILABLE'), 1);
  assert.equal(temporaryFailures('UPSTREAM_TIMEOUT:4'), 4);
  assert.equal(temporaryFailures('LOGIN_ERROR'), 0);
  assert.equal(temporaryFailures(null), 0);
});

Deno.test('RN-81: 5xx da Pluggy numa nova tentativa sobe a contagem; sucesso limpa o erro', async () => {
  const down = setup({
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
              : new Response('{}', { status: 503 }),
          ),
      }),
  });
  (down.store.connections[0] as Row).last_error = 'UPSTREAM_UNAVAILABLE:2';
  const retry = { connectionId: CONN, mode: 'incremental' };
  assert.equal(
    (await handlePluggySync(call(retry, { apikey: 'chave-secreta' }), down.deps)).status,
    502,
  );
  assert.equal((down.store.connections[0] as Row).last_error, 'UPSTREAM_UNAVAILABLE:3');

  const up = setup();
  (up.store.connections[0] as Row).last_error = 'UPSTREAM_UNAVAILABLE:3';
  assert.equal(
    (await handlePluggySync(call(retry, { apikey: 'chave-secreta' }), up.deps)).status,
    200,
  );
  assert.equal((up.store.connections[0] as Row).last_error, null);
});
