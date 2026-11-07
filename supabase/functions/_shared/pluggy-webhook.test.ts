// T-075: `pluggy-webhook` (token em tempo constante, `clientId`, idempotência, 202 + segundo plano, `deleted` de um
// `merged`, `item/created` sem `onSuccess`) e `pluggy-disconnect` (US-46, US-47, RN-81; tech §6.1.4).
import assert from 'node:assert/strict';
import { createState, handle } from '../../../scripts/mock-pluggy.ts';
import { PluggyConnector } from './connectors/pluggy/client.ts';
import type { Card } from './domain/index.ts';
import { pluggyTxId } from './domain/index.ts';
import type { InvoiceRef } from './ingest.ts';
import type { ConnectionRef, LinkStore } from './pluggy-link.ts';
import type { ConnectionRow, ExistingTx, SyncStats, SyncStore } from './pluggy-sync.ts';
import {
  type DisconnectDeps,
  handlePluggyDisconnect,
  handlePluggyWebhook,
  readEvent,
  type WebhookDeps,
} from './pluggy-webhook.ts';

const USER = '00000000-0000-7000-8000-00000000000a';
const OTHER = '00000000-0000-7000-8000-00000000000b';
const CONN = 'b1000000-0000-4000-8000-000000000001';
const CARD_ID = 'c1000000-0000-4000-8000-000000000001';
const TOKEN = 'token-do-webhook-teste';
const CLIENT_ID = 'client-id-teste';
const CARD: Card = {
  id: CARD_ID,
  closingDay: 3,
  dueDay: 10,
  closingDayRule: 'next',
  limitCents: null,
  paymentAccountId: null,
};

type Row = Record<string, unknown>;

/** Banco em memória com o que o webhook, o sync e o vínculo leem e gravam. */
class Memory implements SyncStore, LinkStore {
  connections: Row[] = [];
  ext: Row[] = [];
  invoiceRows: Row[] = [];
  txs: Row[] = [];
  runs: Array<{ status: string; stats?: SyncStats }> = [];
  // LinkStore
  connectionByItem(itemId: string): Promise<ConnectionRef | null> {
    const c = this.connections.find((x) => x.external_item_id === itemId);
    return Promise.resolve(c ? { id: String(c.id), user_id: String(c.user_id) } : null);
  }
  saveConnection(row: Row) {
    this.connections = [
      ...this.connections.filter((c) => c.id !== row.id),
      { last_manual_refresh_at: null, ...row },
    ];
    return Promise.resolve();
  }
  externalAccounts(arg: readonly string[] | string, userId?: string): Promise<never> {
    const rows =
      typeof arg === 'string'
        ? this.ext.filter((a) => a.connection_id === arg && a.user_id === userId)
        : this.ext.filter((a) => arg.includes(String(a.external_account_id)));
    return Promise.resolve(rows as never);
  }
  saveExternalAccounts(rows: readonly Row[]) {
    for (const row of rows) {
      const before = this.ext.find((a) => a.id === row.id);
      this.ext = [
        ...this.ext.filter((a) => a.id !== row.id),
        {
          account_id: null,
          card_id: null,
          is_ignored: false,
          last_tx_date: null,
          ...before,
          ...row,
        },
      ];
    }
    return Promise.resolve();
  }
  // SyncStore
  connection(id: string) {
    return Promise.resolve(
      (this.connections.find((c) => c.id === id) as unknown as ConnectionRow) ?? null,
    );
  }
  updateConnection(id: string, _u: string, patch: Row) {
    Object.assign(this.connections.find((c) => c.id === id) ?? {}, patch);
    return Promise.resolve();
  }
  startRun() {
    this.runs.push({ status: 'running' });
    return Promise.resolve(this.runs.length);
  }
  finishRun(run: number, status: string, stats: SyncStats) {
    Object.assign(this.runs[run - 1] ?? {}, { status, stats });
    return Promise.resolve();
  }
  updateExternalAccount(id: string, _u: string, patch: Row) {
    Object.assign(this.ext.find((a) => a.id === id) ?? {}, patch);
    return Promise.resolve();
  }
  card(id: string) {
    return Promise.resolve(id === CARD_ID ? CARD : null);
  }
  invoices(cardId: string) {
    return Promise.resolve(
      this.invoiceRows.filter((i) => i.card_id === cardId) as unknown as InvoiceRef[],
    );
  }
  insertInvoice(row: Row) {
    if (!this.invoiceRows.some((i) => i.id === row.id)) {
      this.invoiceRows.push({ deleted_at: null, ...row });
    }
    return Promise.resolve();
  }
  updateInvoice(id: string, _u: string, patch: Row) {
    Object.assign(this.invoiceRows.find((i) => i.id === id) ?? {}, patch);
    return Promise.resolve();
  }
  categories() {
    return Promise.resolve([]);
  }
  rules() {
    return Promise.resolve([]);
  }
  startedOn() {
    return Promise.resolve(null);
  }
  existingTransactions(userId: string, ids: readonly string[]) {
    return Promise.resolve(
      this.txs.filter(
        (t) => t.user_id === userId && ids.includes(String(t.external_id)),
      ) as unknown as ExistingTx[],
    );
  }
  insertTransactions(rows: readonly Row[]) {
    this.txs.push(...rows.map((r) => ({ ...r })));
    return Promise.resolve();
  }
  updateTransaction(id: string, _u: string, patch: Row) {
    Object.assign(this.txs.find((t) => t.id === id) ?? {}, patch);
    return Promise.resolve();
  }
}

function setup(options: { linked?: boolean } = {}) {
  const state = createState(50);
  const db = new Memory();
  if (options.linked !== false) {
    db.connections.push({
      id: CONN,
      user_id: USER,
      external_item_id: 'item-nubank',
      is_active: true,
      deleted_at: null,
      last_manual_refresh_at: null,
    });
    db.ext.push({
      id: 'ext-card',
      user_id: USER,
      connection_id: CONN,
      external_account_id: 'acc-nu-card',
      account_id: null,
      card_id: CARD_ID,
      is_ignored: false,
      last_tx_date: null,
      deleted_at: null,
    });
  }
  const connector = () =>
    new PluggyConnector({
      baseUrl: 'http://mock.test',
      clientId: CLIENT_ID,
      clientSecret: 'segredo',
      allowedConnectorIds: [200],
      webhookUrl: null,
      fetch: (input, init) => handle(new Request(input, init), state),
    });
  const events = new Map<string, { processed: boolean; error?: string }>();
  const pending: Promise<unknown>[] = [];
  let n = 0;
  const now = () => new Date('2026-11-07T12:00:00.000Z');
  const deps: WebhookDeps = {
    token: TOKEN,
    clientId: CLIENT_ID,
    link: { connector, allowedConnectorIds: [200], store: db, newId: () => `id-${++n}`, now },
    sync: { connector, store: db, now },
    events: {
      record(eventId) {
        if (events.has(eventId)) {
          return Promise.resolve(false);
        }
        events.set(eventId, { processed: false });
        return Promise.resolve(true);
      },
      done(eventId, error) {
        events.set(eventId, { processed: true, ...(error ? { error } : {}) });
        return Promise.resolve();
      },
    },
    defer: (task) => {
      pending.push(task);
    },
  };
  return { deps, db, state, events, settle: () => Promise.all(pending.splice(0)) };
}

let seq = 0;
function webhook(body: Row, token = TOKEN): Request {
  seq += 1;
  return new Request(`http://fn.test/pluggy-webhook?t=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      eventId: `evt-${seq}`,
      clientId: CLIENT_ID,
      triggeredBy: 'SYNC',
      ...body,
    }),
  });
}

Deno.test('tech §6.1.4: token errado, ausente ou não configurado → 401, sem registrar nada', async () => {
  const { deps, events } = setup();
  for (const token of ['', 'token-errado', `${TOKEN}x`]) {
    assert.equal(
      (
        await handlePluggyWebhook(
          webhook({ event: 'item/updated', itemId: 'item-nubank' }, token),
          deps,
        )
      ).status,
      401,
    );
  }
  const unconfigured = { ...deps, token: null };
  assert.equal(
    (await handlePluggyWebhook(webhook({ event: 'item/updated' }), unconfigured)).status,
    401,
  );
  assert.equal(events.size, 0);
  const get = new Request(`http://fn.test/pluggy-webhook?t=${TOKEN}`);
  assert.equal((await handlePluggyWebhook(get, deps)).status, 405);
});

Deno.test('tech §6.1.4: clientId diferente do nosso → 401; evento malformado → 400', async () => {
  const { deps, events } = setup();
  const res = await handlePluggyWebhook(
    webhook({ event: 'item/updated', clientId: 'outro-cliente' }),
    deps,
  );
  assert.equal(res.status, 401);
  const bad = new Request(`http://fn.test/pluggy-webhook?t=${TOKEN}`, {
    method: 'POST',
    body: '{"event":1}',
  });
  assert.equal((await handlePluggyWebhook(bad, deps)).status, 400);
  assert.equal(events.size, 0);
  assert.deepEqual(
    readEvent({ event: 'x', eventId: 'e', clientId: 'c', transactionIds: ['a', 2, ''] }),
    {
      event: 'x',
      eventId: 'e',
      clientId: 'c',
      itemId: null,
      transactionIds: ['a'],
    },
  );
});

Deno.test('tech §6.1.4: 202 imediato, processamento em segundo plano e o mesmo eventId só uma vez', async () => {
  const { deps, db, events, settle } = setup();
  const first = webhook({
    event: 'transactions/created',
    itemId: 'item-nubank',
    transactionIds: ['tx-nu-001'],
  });
  const body = await first.clone().text();
  const res = await handlePluggyWebhook(first, deps);
  assert.equal(res.status, 202);
  assert.equal(db.txs.length, 0); // ainda não processou
  await settle();
  assert.deepEqual(
    db.txs.map((t) => t.external_id),
    ['tx-nu-001'],
  );
  const eventId = JSON.parse(body).eventId as string;
  assert.deepEqual(events.get(eventId), { processed: true });
  // a Pluggy repete o mesmo evento
  const again = new Request(`http://fn.test/pluggy-webhook?t=${TOKEN}`, { method: 'POST', body });
  const dup = await handlePluggyWebhook(again, deps);
  assert.equal(dup.status, 200);
  assert.deepEqual(await dup.json(), { duplicate: true });
  await settle();
  assert.equal(db.txs.length, 1);
});

Deno.test('US-46: transactions/updated atualiza só as colunas do provedor pelos ids', async () => {
  const { deps, db, state, settle } = setup();
  await handlePluggyWebhook(
    webhook({
      event: 'transactions/created',
      itemId: 'item-nubank',
      transactionIds: ['tx-nu-005'],
    }),
    deps,
  );
  await settle();
  const tx = db.txs[0] as Row;
  tx.category_id = 'cat-do-usuario';
  (state.transactions.find((t) => t.id === 'tx-nu-005') as Row).amount = 210;
  await handlePluggyWebhook(
    webhook({
      event: 'transactions/updated',
      itemId: 'item-nubank',
      transactionIds: ['tx-nu-005'],
    }),
    deps,
  );
  await settle();
  assert.deepEqual([db.txs.length, tx.amount_cents, tx.category_id], [1, 21000, 'cat-do-usuario']);
});

Deno.test('tech §6.1.4: transactions/deleted apaga o importado; o merged desfaz o vínculo do manual', async () => {
  const { deps, db, settle } = setup();
  db.txs.push(
    {
      id: pluggyTxId(USER, 'tx-a'),
      user_id: USER,
      external_id: 'tx-a',
      review_state: 'new',
      deleted_at: null,
    },
    {
      id: pluggyTxId(USER, 'tx-b'),
      user_id: USER,
      external_id: 'tx-b',
      review_state: 'merged',
      duplicate_of: 'manual-1',
      deleted_at: null,
    },
    { id: 'manual-1', user_id: USER, external_id: null, matched_external: true, deleted_at: null },
    // de outro usuário, mesmo id externo: nunca é tocado
    { id: 'outro', user_id: OTHER, external_id: 'tx-a', review_state: 'new', deleted_at: null },
  );
  await handlePluggyWebhook(
    webhook({
      event: 'transactions/deleted',
      itemId: 'item-nubank',
      transactionIds: ['tx-a', 'tx-b', 'tx-z'],
    }),
    deps,
  );
  await settle();
  const byId = new Map(db.txs.map((t) => [t.id, t]));
  assert.equal(byId.get(pluggyTxId(USER, 'tx-a'))?.deleted_at, '2026-11-07T12:00:00.000Z');
  assert.equal(byId.get(pluggyTxId(USER, 'tx-b'))?.deleted_at, null);
  assert.equal(byId.get('manual-1')?.matched_external, false);
  assert.equal(byId.get('outro')?.deleted_at, null);
});

Deno.test('tech §6.1.4: item/created sem onSuccess vincula pelo clientUserId; item desconhecido é ignorado', async () => {
  const { deps, db, events, settle } = setup({ linked: false });
  await handlePluggyWebhook(webhook({ event: 'item/created', itemId: 'item-nubank' }), deps);
  await settle();
  assert.deepEqual(
    db.connections.map((c) => [c.user_id, c.external_item_id]),
    [[USER, 'item-nubank']],
  );
  assert.equal(db.ext.length, 2);
  // item da Demo sem clientUserId: não há a quem vincular
  await handlePluggyWebhook(webhook({ event: 'item/created', itemId: 'item-bb' }), deps);
  // evento de item que não conhecemos
  await handlePluggyWebhook(
    webhook({ event: 'transactions/created', itemId: 'item-desconhecido', transactionIds: ['x'] }),
    deps,
  );
  await handlePluggyWebhook(webhook({ event: 'connector/status_updated' }), deps);
  await settle();
  assert.equal(db.connections.length, 1);
  assert.ok([...events.values()].every((e) => e.processed && !e.error));
});

Deno.test('RN-81: item/error atualiza o estado; item/updated sincroniza; item/deleted desativa', async () => {
  const { deps, db, state, settle } = setup();
  (state.items.get('item-nubank') as Row).status = 'OUTDATED';
  await handlePluggyWebhook(webhook({ event: 'item/error', itemId: 'item-nubank' }), deps);
  await settle();
  assert.equal(db.connections[0]?.status, 'OUTDATED');
  await handlePluggyWebhook(webhook({ event: 'item/updated', itemId: 'item-nubank' }), deps);
  await settle();
  assert.equal(db.txs.length, 5);
  assert.equal(db.runs.at(-1)?.status, 'ok');
  await handlePluggyWebhook(webhook({ event: 'item/deleted', itemId: 'item-nubank' }), deps);
  await settle();
  assert.equal(db.connections[0]?.is_active, false);
  // inativa: eventos seguintes não importam nada
  await handlePluggyWebhook(
    webhook({
      event: 'transactions/created',
      itemId: 'item-nubank',
      transactionIds: ['tx-nu-cc-001'],
    }),
    deps,
  );
  await settle();
  assert.equal(db.txs.length, 5);
});

Deno.test('erro no processamento fica registrado no evento, sem derrubar a resposta 202', async () => {
  const { deps, events, settle } = setup();
  const broken: WebhookDeps = {
    ...deps,
    sync: {
      ...deps.sync,
      connector: () => {
        throw new Error('sem segredos');
      },
    },
  };
  const res = await handlePluggyWebhook(
    webhook({ event: 'item/error', itemId: 'item-nubank' }),
    broken,
  );
  assert.equal(res.status, 202);
  await settle();
  assert.deepEqual([...events.values()].at(-1), { processed: true, error: 'INTERNAL' });
});

function disconnect(body: unknown, token = 'token-a') {
  return new Request('http://fn.test/pluggy-disconnect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, origin: 'https://app.example.test' },
    body: JSON.stringify(body),
  });
}

Deno.test('US-47: desconectar desliga a conexão e as contas e, se pedido, apaga o item na Pluggy', async () => {
  const { db, state } = setup();
  const deps: DisconnectDeps = {
    cors: { appOrigin: 'https://app.example.test' },
    caller: (authorization) =>
      Promise.resolve(
        authorization === 'Bearer token-a'
          ? { userId: USER, hit: () => Promise.resolve(true) }
          : authorization === 'Bearer token-b'
            ? { userId: OTHER, hit: () => Promise.resolve(true) }
            : null,
      ),
    connector: () =>
      new PluggyConnector({
        baseUrl: 'http://mock.test',
        clientId: CLIENT_ID,
        clientSecret: 'segredo',
        allowedConnectorIds: [200],
        webhookUrl: null,
        fetch: (input, init) => handle(new Request(input, init), state),
      }),
    store: db,
    now: () => new Date('2026-11-07T12:00:00.000Z'),
  };
  assert.equal(
    (
      await handlePluggyDisconnect(
        disconnect({ connectionId: CONN, deleteAtProvider: true }, 'token-b'),
        deps,
      )
    ).status,
    404,
  );
  assert.equal(
    (await handlePluggyDisconnect(disconnect({ connectionId: CONN }), deps)).status,
    400,
  );
  assert.equal(
    (
      await handlePluggyDisconnect(
        disconnect({ connectionId: CONN, deleteAtProvider: true }, 'x'),
        deps,
      )
    ).status,
    401,
  );
  const res = await handlePluggyDisconnect(
    disconnect({ connectionId: CONN, deleteAtProvider: true }),
    deps,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(state.items.has('item-nubank'), false);
  assert.deepEqual(
    [db.connections[0]?.is_active, db.connections[0]?.deleted_at],
    [false, '2026-11-07T12:00:00.000Z'],
  );
  assert.equal(db.ext[0]?.deleted_at, '2026-11-07T12:00:00.000Z');
  // de novo: já desconectada
  assert.equal(
    (await handlePluggyDisconnect(disconnect({ connectionId: CONN, deleteAtProvider: true }), deps))
      .status,
    404,
  );
  // item já apagado na Pluggy não impede desconectar
  const second = setup();
  second.state.items.delete('item-nubank');
  const deps2 = { ...deps, store: second.db, connector: () => deps.connector() };
  assert.equal(
    (
      await handlePluggyDisconnect(
        disconnect({ connectionId: CONN, deleteAtProvider: true }),
        deps2,
      )
    ).status,
    200,
  );
  // sem apagar na Pluggy, nem chama o conector
  const third = setup();
  const deps3 = {
    ...deps,
    store: third.db,
    connector: () => {
      throw new Error('não deveria chamar');
    },
  };
  assert.equal(
    (
      await handlePluggyDisconnect(
        disconnect({ connectionId: CONN, deleteAtProvider: false }),
        deps3,
      )
    ).status,
    200,
  );
  assert.equal(third.state.items.has('item-nubank'), true);
  const options = new Request('http://fn.test/x', {
    method: 'OPTIONS',
    headers: { origin: 'https://app.example.test' },
  });
  assert.ok((await handlePluggyDisconnect(options, deps)).status < 300);
});
