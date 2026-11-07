// `pluggy-connect-token` e `pluggy-link-item` (tech §6.0 [CONTRATO] e §6.1.3 passos 2 e 4; US-45, RN-79). Os
// handlers recebem o conector e o armazenamento por injeção: o `index.ts` de cada função liga o Supabase (token do
// usuário para a auth e o rate limit; chave secreta, sempre com `user_id` explícito, para gravar conexões e contas,
// que o app só lê).
import type { BankConnector, ProviderAccount, ProviderItem } from './connectors/types.ts';
import { AppError } from './errors.ts';
import { type CorsConfig, handleError, jsonResponse, preflight, readJson } from './http.ts';
import { SERVER_DEVICE } from './ingest.ts';
import {
  type Caller,
  enforceRate,
  fromProvider,
  readItemId,
  requireCaller,
} from './pluggy-functions.ts';

/** Conector com o que só a Pluggy tem (preencher o `clientUserId` de item criado pela Demo). */
export interface LinkConnector extends BankConnector {
  setClientUserId(itemId: string, userId: string): Promise<void>;
}

export interface ConnectionRef {
  id: string;
  user_id: string;
}

export interface ExternalAccountRef {
  id: string;
  user_id: string;
  external_account_id: string;
  account_id: string | null;
  card_id: string | null;
  is_ignored: boolean;
}

export interface LinkStore {
  connectionByItem(itemId: string): Promise<ConnectionRef | null>;
  saveConnection(row: Record<string, unknown>): Promise<void>;
  externalAccounts(externalIds: readonly string[]): Promise<ExternalAccountRef[]>;
  saveExternalAccounts(rows: readonly Record<string, unknown>[]): Promise<void>;
}

export interface PluggyDeps {
  cors: CorsConfig;
  /** Quem chama, pelo token; `null` = token inválido. */
  caller(authorization: string): Promise<Caller | null>;
  /** O conector configurado; lança se os segredos faltarem. */
  connector(): LinkConnector;
  allowedConnectorIds: readonly number[];
  store: LinkStore;
  newId: () => string;
  now: () => Date;
}

function connectorOf(deps: PluggyDeps): LinkConnector {
  try {
    return deps.connector();
  } catch {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Open Finance não configurado.');
  }
}

async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw fromProvider(error);
  }
}

/** `pluggy-connect-token` `{ itemId? }` → `{ connectToken, connectorIds, expiresAt }`. */
export async function handleConnectToken(request: Request, deps: PluggyDeps): Promise<Response> {
  const early = preflight(request, deps.cors);
  if (early) {
    return early;
  }
  try {
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    const caller = await requireCaller(request, deps.caller);
    const itemId = readItemId(await readJson(request), false);
    await enforceRate(caller, 'pluggy-connect');
    if (itemId) {
      // renovar só a própria conexão
      const own = await deps.store.connectionByItem(itemId);
      if (!own || own.user_id !== caller.userId) {
        throw new AppError('ITEM_NOT_FOUND');
      }
    }
    const connector = connectorOf(deps);
    const token = await guarded(() =>
      connector.createConnectToken({ userId: caller.userId, ...(itemId ? { itemId } : {}) }),
    );
    return jsonResponse(
      { connectToken: token.token, connectorIds: token.connectorIds, expiresAt: token.expiresAt },
      request,
      deps.cors,
    );
  } catch (error) {
    return handleError(error, request, deps.cors);
  }
}

/** Conta externa como a tela de mapeamento recebe (tech §6.1.3 passo 5). */
export interface ExternalAccountDTO {
  id: string;
  type: string;
  subtype: string;
  name: string | null;
  numberMasked: string | null;
  accountId: string | null;
  cardId: string | null;
  isIgnored: boolean;
  /** Para "criar novo" cartão: dias de `balanceCloseDate`/`balanceDueDate` e o limite. */
  suggestion: {
    closingDay: number | null;
    dueDay: number | null;
    limitCents: number | null;
  } | null;
}

function dayOf(date: string | null): number | null {
  return date ? Number(date.slice(8, 10)) : null;
}

export function connectionRow(
  id: string,
  userId: string,
  item: ProviderItem,
  nowIso: string,
): Record<string, unknown> {
  return {
    id,
    user_id: userId,
    provider: 'pluggy',
    external_item_id: item.id,
    connector_id: item.connectorId,
    connector_name: item.connectorName,
    status: item.status,
    execution_status: item.executionStatus,
    consent_expires_at: item.consentExpiresAt,
    provider_updated_at: item.updatedAt,
    last_error: null,
    is_active: true,
    deleted_at: null,
    client_updated_at: nowIso,
    device_id: SERVER_DEVICE,
  };
}

/** Linha de `external_accounts` sem o mapeamento (conta, cartão, ignorada): esse é do usuário e nunca é tocado. */
export function externalAccountRow(
  id: string,
  userId: string,
  connectionId: string,
  account: ProviderAccount,
  nowIso: string,
): Record<string, unknown> {
  return {
    id,
    user_id: userId,
    connection_id: connectionId,
    external_account_id: account.id,
    type: account.type,
    subtype: account.subtype,
    name: account.name,
    number_masked: account.numberMasked,
    balance_cents: account.balanceCents,
    credit_limit_cents: account.credit?.limitCents ?? null,
    available_limit_cents: account.credit?.availableLimitCents ?? null,
    balance_close_date: account.credit?.closeDate ?? null,
    balance_due_date: account.credit?.dueDate ?? null,
    deleted_at: null,
    client_updated_at: nowIso,
    device_id: SERVER_DEVICE,
  };
}

/**
 * `pluggy-link-item` `{ itemId }` → `{ connectionId, status, accounts }`. Valida o item na Pluggy (existe; é do
 * chamador ou, sem dono, ganha o `clientUserId` dele; conector permitido), recusa item de outro usuário e grava
 * conexão e contas.
 */
export async function handleLinkItem(request: Request, deps: PluggyDeps): Promise<Response> {
  const early = preflight(request, deps.cors);
  if (early) {
    return early;
  }
  try {
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    const caller = await requireCaller(request, deps.caller);
    const itemId = readItemId(await readJson(request), true) as string;
    await enforceRate(caller, 'pluggy-link');
    const existing = await deps.store.connectionByItem(itemId);
    if (existing && existing.user_id !== caller.userId) {
      throw new AppError('ITEM_FOREIGN');
    }
    const connector = connectorOf(deps);
    const item = await guarded(() => connector.getItem(itemId));
    if (item.clientUserId !== null && item.clientUserId !== caller.userId) {
      throw new AppError('ITEM_FOREIGN');
    }
    if (item.connectorId === null || !deps.allowedConnectorIds.includes(item.connectorId)) {
      throw new AppError('CONNECTOR_NOT_ALLOWED');
    }
    if (item.clientUserId === null) {
      await guarded(() => connector.setClientUserId(itemId, caller.userId));
    }
    const nowIso = deps.now().toISOString();
    const connectionId = existing?.id ?? deps.newId();
    await deps.store.saveConnection(connectionRow(connectionId, caller.userId, item, nowIso));

    const accounts = await guarded(() => connector.listAccounts(itemId));
    const known = new Map(
      (await deps.store.externalAccounts(accounts.map((a) => a.id))).map((r) => [
        r.external_account_id,
        r,
      ]),
    );
    const own = accounts.filter((a) => {
      const ref = known.get(a.id);
      return !ref || ref.user_id === caller.userId;
    });
    const rows = own.map((a) =>
      externalAccountRow(
        known.get(a.id)?.id ?? deps.newId(),
        caller.userId,
        connectionId,
        a,
        nowIso,
      ),
    );
    await deps.store.saveExternalAccounts(rows);

    const dto: ExternalAccountDTO[] = own.map((a, i) => {
      const ref = known.get(a.id);
      return {
        id: String(rows[i]?.id),
        type: a.type,
        subtype: a.subtype,
        name: a.name,
        numberMasked: a.numberMasked,
        accountId: ref?.account_id ?? null,
        cardId: ref?.card_id ?? null,
        isIgnored: ref?.is_ignored ?? false,
        suggestion: a.credit
          ? {
              closingDay: dayOf(a.credit.closeDate),
              dueDay: dayOf(a.credit.dueDate),
              limitCents: a.credit.limitCents,
            }
          : null,
      };
    });
    return jsonResponse({ connectionId, status: item.status, accounts: dto }, request, deps.cors);
  } catch (error) {
    return handleError(error, request, deps.cors);
  }
}
