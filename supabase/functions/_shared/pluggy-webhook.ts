// `pluggy-webhook` e `pluggy-disconnect` (tech §6.0 [CONTRATO] e §6.1.4; US-46, US-47, RN-81). O webhook não tem
// assinatura: o segredo vem na URL (`?t=`), comparado em tempo constante, e o `clientId` do corpo precisa ser o
// nosso. Cada `eventId` é registrado uma vez (`integration_events`); a resposta é 202 imediato e o processamento
// segue em segundo plano (`EdgeRuntime.waitUntil`), porque a Pluggy exige 2xx em até 10 s.
import { sameSecret } from './auth.ts';
import { AppError } from './errors.ts';
import { type CorsConfig, handleError, jsonResponse, preflight, readJson } from './http.ts';
import { SERVER_DEVICE } from './ingest.ts';
import { type Caller, fromProvider, requireCaller } from './pluggy-functions.ts';
import { type LinkConnector, linkItem, type PluggyDeps } from './pluggy-link.ts';
import { runSync, type SyncDeps, type SyncStats, type SyncStore } from './pluggy-sync.ts';

export interface WebhookStore {
  /** `false` = o `eventId` já tinha chegado. */
  record(
    eventId: string,
    event: string,
    itemId: string | null,
    userId: string | null,
    payload: unknown,
  ): Promise<boolean>;
  done(eventId: string, error?: string): Promise<void>;
}

export interface WebhookDeps {
  /** `PLUGGY_WEBHOOK_TOKEN` e `PLUGGY_CLIENT_ID`; sem eles, todo evento é recusado. */
  token: string | null;
  clientId: string | null;
  link: Pick<PluggyDeps, 'connector' | 'allowedConnectorIds' | 'store' | 'newId' | 'now'>;
  sync: SyncDeps;
  events: WebhookStore;
  /** `EdgeRuntime.waitUntil` (nos testes, guarda a promessa). */
  defer(task: Promise<unknown>): void;
}

export interface PluggyEvent {
  event: string;
  eventId: string;
  clientId: string;
  itemId: string | null;
  transactionIds: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readEvent(body: unknown): PluggyEvent {
  const raw = (body ?? {}) as Record<string, unknown>;
  const ok = (v: unknown, max = 200): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!ok(raw.event, 60) || !ok(raw.eventId) || !ok(raw.clientId)) {
    throw new AppError('BAD_REQUEST', 'Evento inválido.');
  }
  const ids = Array.isArray(raw.transactionIds) ? raw.transactionIds.filter((id) => ok(id)) : [];
  return {
    event: raw.event,
    eventId: raw.eventId,
    clientId: raw.clientId,
    itemId: ok(raw.itemId) ? raw.itemId : null,
    transactionIds: ids.slice(0, 1000),
  };
}

/**
 * `transactions/deleted` (tech §6.1.4): exclusão lógica dos importados, **exceto** os `merged` — nesses, desfaz o
 * vínculo no manual (`matched_external = false`) para o reaparecimento com id novo voltar a conciliar.
 */
export async function deleteImported(
  store: SyncStore,
  userId: string,
  externalIds: readonly string[],
  nowIso: string,
): Promise<SyncStats> {
  const stats: SyncStats = { accounts: 0, inserted: 0, updated: 0, deleted: 0, bills: 0 };
  const stamp = { client_updated_at: nowIso, device_id: SERVER_DEVICE };
  for (const tx of await store.existingTransactions(userId, externalIds)) {
    if (tx.deleted_at) {
      continue;
    }
    if (tx.review_state === 'merged') {
      if (tx.duplicate_of) {
        await store.updateTransaction(tx.duplicate_of, userId, {
          matched_external: false,
          ...stamp,
        });
        stats.updated += 1;
      }
      continue;
    }
    await store.updateTransaction(tx.id, userId, { deleted_at: nowIso, ...stamp });
    stats.deleted += 1;
  }
  return stats;
}

/** Processa um evento já registrado (em segundo plano). */
export async function processEvent(event: PluggyEvent, deps: WebhookDeps): Promise<void> {
  if (!event.itemId) {
    return;
  }
  const ref = await deps.link.store.connectionByItem(event.itemId);
  const connection = ref ? await deps.sync.store.connection(ref.id) : null;
  const now = deps.sync.now();
  const nowIso = now.toISOString();
  const active = connection && connection.deleted_at === null && connection.is_active;

  if (event.event === 'item/created' && !connection) {
    // o `onSuccess` do widget nem sempre é chamado (tech §6.1.1): vincula pelo `clientUserId` do item
    const connector = deps.link.connector() as LinkConnector;
    const item = await connector.getItem(event.itemId);
    if (item.clientUserId && UUID_RE.test(item.clientUserId)) {
      await linkItem(item.clientUserId, event.itemId, deps.link);
    }
    return;
  }
  if (!connection) {
    return; // item desconhecido: fica registrado e é ignorado
  }
  if (event.event === 'item/deleted') {
    await deps.sync.store.updateConnection(connection.id, connection.user_id, {
      is_active: false,
      client_updated_at: nowIso,
      device_id: SERVER_DEVICE,
    });
    return;
  }
  if (!active) {
    return;
  }
  switch (event.event) {
    case 'transactions/created':
    case 'transactions/updated':
      if (event.transactionIds.length > 0) {
        await runSync(
          connection,
          { connectionId: connection.id, mode: 'incremental', ids: event.transactionIds },
          deps.sync,
        );
      }
      return;
    case 'transactions/deleted':
      await deleteImported(deps.sync.store, connection.user_id, event.transactionIds, nowIso);
      return;
    case 'item/updated':
      await runSync(connection, { connectionId: connection.id, mode: 'incremental' }, deps.sync);
      return;
    default:
      if (event.event.startsWith('item/')) {
        // item/error, item/login_succeeded, item/waiting_user_input…: só o estado
        const item = await deps.sync.connector().getItem(event.itemId);
        await deps.sync.store.updateConnection(connection.id, connection.user_id, {
          status: item.status,
          execution_status: item.executionStatus,
          consent_expires_at: item.consentExpiresAt,
          provider_updated_at: item.updatedAt,
          client_updated_at: nowIso,
          device_id: SERVER_DEVICE,
        });
      }
  }
}

function codeOf(error: unknown): string {
  const mapped = fromProvider(error);
  return mapped instanceof AppError ? mapped.code : 'INTERNAL';
}

const NO_CORS: CorsConfig = {};

/** `pluggy-webhook`: token e `clientId` → registro idempotente → 202 e processamento em segundo plano. */
export async function handlePluggyWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    const token = new URL(request.url).searchParams.get('t') ?? '';
    if (!deps.token || !deps.clientId || !sameSecret(token, deps.token)) {
      throw new AppError('UNAUTHORIZED');
    }
    const event = readEvent(await readJson(request));
    if (!sameSecret(event.clientId, deps.clientId)) {
      throw new AppError('UNAUTHORIZED');
    }
    const ref = event.itemId ? await deps.link.store.connectionByItem(event.itemId) : null;
    const fresh = await deps.events.record(
      event.eventId,
      event.event,
      event.itemId,
      ref?.user_id ?? null,
      {
        event: event.event,
        eventId: event.eventId,
        itemId: event.itemId,
        transactionIds: event.transactionIds,
      },
    );
    if (!fresh) {
      return jsonResponse({ duplicate: true }, request, NO_CORS);
    }
    deps.defer(
      processEvent(event, deps).then(
        () => deps.events.done(event.eventId),
        (error) => deps.events.done(event.eventId, codeOf(error)),
      ),
    );
    return jsonResponse({ accepted: true }, request, NO_CORS, 202);
  } catch (error) {
    return handleError(error, request, NO_CORS);
  }
}

export interface DisconnectDeps {
  cors: CorsConfig;
  caller(authorization: string): Promise<Caller | null>;
  connector(): LinkConnector;
  store: SyncStore;
  now: () => Date;
}

/**
 * `pluggy-disconnect` `{ connectionId, deleteAtProvider }` → `{ ok: true }`. Desliga a conexão e as contas externas
 * (exclusão lógica; os lançamentos importados ficam) e, se pedido, apaga o item na Pluggy.
 */
export async function handlePluggyDisconnect(
  request: Request,
  deps: DisconnectDeps,
): Promise<Response> {
  const early = preflight(request, deps.cors);
  if (early) {
    return early;
  }
  try {
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    const caller = await requireCaller(request, deps.caller);
    const body = (await readJson(request)) as Record<string, unknown> | null;
    const connectionId = body?.connectionId;
    const deleteAtProvider = body?.deleteAtProvider;
    if (
      typeof connectionId !== 'string' ||
      !UUID_RE.test(connectionId) ||
      typeof deleteAtProvider !== 'boolean'
    ) {
      throw new AppError('BAD_REQUEST', 'connectionId e deleteAtProvider são obrigatórios.');
    }
    const connection = await deps.store.connection(connectionId);
    if (!connection || connection.user_id !== caller.userId || connection.deleted_at !== null) {
      throw new AppError('NOT_FOUND');
    }
    if (deleteAtProvider) {
      let connector: LinkConnector;
      try {
        connector = deps.connector();
      } catch {
        throw new AppError('UPSTREAM_UNAVAILABLE', 'Open Finance não configurado.');
      }
      try {
        await connector.deleteItem(connection.external_item_id);
      } catch (error) {
        const mapped = fromProvider(error);
        // já apagado na Pluggy: segue
        if (!(mapped instanceof AppError && mapped.code === 'ITEM_NOT_FOUND')) {
          throw mapped;
        }
      }
    }
    const nowIso = deps.now().toISOString();
    const stamp = { deleted_at: nowIso, client_updated_at: nowIso, device_id: SERVER_DEVICE };
    for (const account of await deps.store.externalAccounts(connection.id, caller.userId)) {
      if (account.deleted_at === null) {
        await deps.store.updateExternalAccount(account.id, caller.userId, stamp);
      }
    }
    await deps.store.updateConnection(connection.id, caller.userId, { is_active: false, ...stamp });
    return jsonResponse({ ok: true }, request, deps.cors);
  } catch (error) {
    return handleError(error, request, deps.cors);
  }
}
