// `account-delete` (tech §6.0 [CONTRATO], US-61): `{ confirm: 'EXCLUIR' }` → `{ ok: true }`. Auth do usuário: só
// apaga a própria conta. Antes, tenta apagar na Pluggy cada item conectado (`DELETE /items`); falha ali não impede a
// exclusão (o app orienta a revogar também no Meu Pluggy). Depois remove o usuário de `auth.users`, e o banco apaga
// o resto em cascata (todas as tabelas com `user_id` referenciam `auth.users … on delete cascade`).
import type { BankConnector } from './connectors/types.ts';
import { AppError } from './errors.ts';
import { type CorsConfig, handleError, jsonResponse, preflight, readJson } from './http.ts';
import { type Caller, requireCaller } from './pluggy-functions.ts';

export const DELETE_CONFIRMATION = 'EXCLUIR';

export interface AccountConnection {
  id: string;
  external_item_id: string;
  deleted_at: string | null;
}

export interface AccountDeleteStore {
  /** Conexões bancárias do usuário (ativas ou não). */
  connections(userId: string): Promise<AccountConnection[]>;
  /** Remove o usuário de `auth.users` (cascata no banco). */
  deleteUser(userId: string): Promise<void>;
}

export interface AccountDeleteDeps {
  cors: CorsConfig;
  caller(authorization: string): Promise<Caller | null>;
  /** Lança se a Pluggy não estiver configurada. */
  connector(): Pick<BankConnector, 'deleteItem'>;
  store: AccountDeleteStore;
}

/** Apaga na Pluggy os itens ainda conectados; devolve quantos não puderam ser apagados. */
export async function revokeItems(
  connections: readonly AccountConnection[],
  connector: () => Pick<BankConnector, 'deleteItem'>,
): Promise<number> {
  const active = connections.filter((c) => c.deleted_at === null && c.external_item_id);
  if (active.length === 0) {
    return 0;
  }
  let client: Pick<BankConnector, 'deleteItem'>;
  try {
    client = connector();
  } catch {
    return active.length;
  }
  let failed = 0;
  for (const connection of active) {
    try {
      await client.deleteItem(connection.external_item_id);
    } catch {
      // já apagado (404) ou Pluggy fora: segue, o app orienta revogar no Meu Pluggy
      failed += 1;
    }
  }
  return failed;
}

export async function handleAccountDelete(
  request: Request,
  deps: AccountDeleteDeps,
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
    if (body?.confirm !== DELETE_CONFIRMATION) {
      throw new AppError('BAD_REQUEST', 'Digite EXCLUIR para confirmar.');
    }
    await revokeItems(await deps.store.connections(caller.userId), deps.connector);
    await deps.store.deleteUser(caller.userId);
    return jsonResponse({ ok: true }, request, deps.cors);
  } catch (error) {
    return handleError(error, request, deps.cors);
  }
}
