// Chamadas das telas de conexão (tech §6.0, §6.1.3): o aparelho só fala com as Edge Functions e com a RPC
// `map_external_account`, nunca com a API da Pluggy (US-45, "Segredos protegidos").
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OakDb } from '../../data/db';
import { createAccount } from '../../data/repositories/accounts';
import { createCard, parseDay } from '../../data/repositories/cards';
import { t } from '../../i18n/pt-BR';
import { type InvokeResult, invokeFunction } from '../../lib/functions';
import {
  BACKFILL_DAYS,
  type ConnectTokenResponse,
  type ExternalAccountDTO,
  isCredit,
  type LinkResponse,
  type MapChoice,
  mapArgs,
  type SyncResponse,
} from './model';

type Functions = Pick<SupabaseClient, 'functions'>;

/** O que a RPC de mapeamento precisa do cliente do supabase-js. */
export interface MapClient {
  rpc(
    fn: 'map_external_account',
    args: ReturnType<typeof mapArgs>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

interface E2eApi {
  respond(name: string, body: Record<string, unknown>): unknown;
}

/**
 * Só no build E2E (E10): o Playwright responde as funções da Pluggy e a RPC de mapeamento por
 * `window.__oakE2EPluggyApi` (como o `__oakE2ENfce` da NFC-e). Sem os segredos do SETUP-13 as funções devolvem 502
 * no Supabase local. Some do build de produção (constante falsa).
 */
export function withE2e<C extends Functions & MapClient>(client: C): C {
  if (import.meta.env.VITE_E2E !== '1') {
    return client;
  }
  const api = (globalThis as { __oakE2EPluggyApi?: E2eApi }).__oakE2EPluggyApi;
  if (!api || typeof api.respond !== 'function') {
    return client;
  }
  const fake = {
    functions: {
      invoke: (name: string, options?: { body?: Record<string, unknown> }) =>
        Promise.resolve({ data: api.respond(name, options?.body ?? {}), error: null }),
    },
    rpc: (name: string, args: Record<string, unknown>) =>
      Promise.resolve({ data: api.respond(name, args), error: null }),
  };
  return fake as unknown as C;
}

export function requestConnectToken(
  client: Functions,
  itemId?: string,
): Promise<InvokeResult<ConnectTokenResponse>> {
  return invokeFunction<ConnectTokenResponse>(
    client,
    'pluggy-connect-token',
    itemId ? { itemId } : {},
  );
}

export function linkItem(client: Functions, itemId: string): Promise<InvokeResult<LinkResponse>> {
  return invokeFunction<LinkResponse>(client, 'pluggy-link-item', { itemId });
}

/** Primeira sincronização: últimos 90 dias (RN-80). */
export function backfill(
  client: Functions,
  connectionId: string,
): Promise<InvokeResult<SyncResponse>> {
  return invokeFunction<SyncResponse>(client, 'pluggy-sync', {
    connectionId,
    mode: 'backfill',
    days: BACKFILL_DAYS,
  });
}

/** "Atualizar agora": incremental com `refresh` (no máximo 1 vez por hora, RN-80). */
export function refreshNow(
  client: Functions,
  connectionId: string,
): Promise<InvokeResult<SyncResponse>> {
  return invokeFunction<SyncResponse>(client, 'pluggy-sync', {
    connectionId,
    mode: 'incremental',
    refresh: true,
  });
}

export function disconnect(
  client: Functions,
  connectionId: string,
): Promise<InvokeResult<{ ok: true }>> {
  return invokeFunction<{ ok: true }>(client, 'pluggy-disconnect', {
    connectionId,
    deleteAtProvider: false,
  });
}

export interface MappingDeps {
  db: OakDb;
  userId: string;
  client: MapClient;
  today: string;
  institution: string | null;
  /** Envia ao servidor as contas e cartões criados agora, antes da RPC (que confere se existem). */
  flush: () => Promise<boolean>;
  notifyWrite: () => void;
}

export type MappingResult = { ok: true } | { ok: false; accountId: string | null; message: string };

/**
 * Grava o mapeamento (tech §6.1.3 passo 5): cria no aparelho as contas e cartões novos, envia, e chama a RPC
 * `map_external_account` para cada conta do banco.
 */
export async function applyMapping(
  accounts: readonly ExternalAccountDTO[],
  choices: Readonly<Record<string, MapChoice>>,
  deps: MappingDeps,
): Promise<MappingResult> {
  const resolved = new Map<string, { kind: 'account' | 'card'; id: string } | null>();
  let created = false;
  for (const account of accounts) {
    const choice = choices[account.id];
    if (!choice || choice.kind === 'ignore') {
      resolved.set(account.id, null);
      continue;
    }
    if (choice.kind === 'link') {
      const [kind, id = ''] = choice.target.split(':');
      resolved.set(account.id, { kind: kind === 'card' ? 'card' : 'account', id });
      continue;
    }
    if (isCredit(account)) {
      const closingDay = parseDay(choice.closingDay);
      const dueDay = parseDay(choice.dueDay);
      if (closingDay === null || dueDay === null) {
        return { ok: false, accountId: account.id, message: t('cards.invalidDay') };
      }
      const result = await createCard(deps.db, deps.userId, {
        name: choice.name,
        closingDay,
        dueDay,
        limitCents: account.suggestion?.limitCents ?? null,
      });
      if (!result.ok || !result.value) {
        return { ok: false, accountId: account.id, message: nameMessage(result, 'card') };
      }
      resolved.set(account.id, { kind: 'card', id: result.value.id });
    } else {
      const result = await createAccount(deps.db, deps.userId, {
        name: choice.name,
        type: 'checking',
        institution: deps.institution,
        initialBalanceOn: deps.today,
      });
      if (!result.ok || !result.value) {
        return { ok: false, accountId: account.id, message: nameMessage(result, 'account') };
      }
      resolved.set(account.id, { kind: 'account', id: result.value.id });
    }
    created = true;
  }
  if (created) {
    deps.notifyWrite();
    if (!(await deps.flush())) {
      return { ok: false, accountId: null, message: t('conn.failed') };
    }
  }
  for (const account of accounts) {
    const { error } = await deps.client.rpc(
      'map_external_account',
      mapArgs(account.id, resolved.get(account.id) ?? null),
    );
    if (error) {
      return { ok: false, accountId: account.id, message: t('conn.failed') };
    }
  }
  return { ok: true };
}

function nameMessage(
  result: { ok: boolean; error?: { code: string; problem?: string } },
  kind: 'account' | 'card',
): string {
  const problem = result.ok ? null : (result.error?.problem ?? null);
  if (problem === 'duplicate') {
    return t(kind === 'card' ? 'cards.duplicate' : 'accounts.duplicate');
  }
  if (problem === 'tooLong') {
    return t('accounts.nameTooLong');
  }
  if (problem === 'required') {
    return t('accounts.nameRequired');
  }
  return t('conn.failed');
}
