// Cliente da API da Pluggy (tech §6.1.1 e §6.1.2), implementando o `BankConnector`. Só roda no servidor: o
// `apiKey` (2 h) é obtido com `POST /auth` e guardado só em memória, nunca persistido nem logado (§6.1.5).
// Transações só pelo `GET /v2/transactions` (cursor em `next`): o `GET /transactions` por página é descontinuado
// em 31/12/2026 e NÃO é usado.
import type { ISODate } from '../../domain/index.ts';
import type { EnvReader } from '../../http.ts';
import {
  type BankConnector,
  type ProviderAccount,
  type ProviderBill,
  ProviderError,
  type ProviderItem,
  type ProviderTransaction,
} from '../types.ts';
import {
  mapAccount,
  mapBill,
  mapItem,
  mapTransaction,
  PluggyPage,
  PluggyTransactionsPage,
} from './map.ts';

export const PLUGGY_API_URL = 'https://api.pluggy.ai';
/** O `apiKey` vale 2 h; renovamos antes, com folga. */
export const API_KEY_TTL_MS = 110 * 60 * 1000;
/** O connect token vale 30 min. */
export const CONNECT_TOKEN_TTL_MS = 30 * 60 * 1000;
/** Ids por chamada do `/v2/transactions?ids=`. */
export const IDS_PER_CALL = 100;
/** Teto de páginas por iteração (proteção contra cursor que não acaba). */
export const MAX_PAGES = 200;

export interface PluggyConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Conectores aceitos (o MeuPluggy, `PLUGGY_ALLOWED_CONNECTOR_IDS`). */
  allowedConnectorIds: number[];
  /** URL do `pluggy-webhook` com o token (`?t=`). */
  webhookUrl: string | null;
  fetch?: typeof fetch;
  now?: () => number;
}

function required(env: EnvReader, name: string): string {
  const value = env.get(name)?.trim();
  if (!value) {
    throw new ProviderError('PROVIDER_AUTH');
  }
  return value;
}

/**
 * Configuração a partir dos segredos das Edge Functions. `PLUGGY_API_URL` (o mock local) só vale com
 * `APP_ENV=local` (tech §8.2); fora disso, sempre a API real.
 */
export function pluggyConfigFromEnv(env: EnvReader): PluggyConfig {
  const local = env.get('APP_ENV') === 'local';
  const override = env.get('PLUGGY_API_URL')?.trim();
  const supabaseUrl = env.get('SUPABASE_URL')?.trim().replace(/\/+$/, '');
  const token = env.get('PLUGGY_WEBHOOK_TOKEN')?.trim();
  return {
    baseUrl: (local && override ? override : PLUGGY_API_URL).replace(/\/+$/, ''),
    clientId: required(env, 'PLUGGY_CLIENT_ID'),
    clientSecret: required(env, 'PLUGGY_CLIENT_SECRET'),
    allowedConnectorIds: (env.get('PLUGGY_ALLOWED_CONNECTOR_IDS') ?? '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0),
    webhookUrl:
      supabaseUrl && token
        ? `${supabaseUrl}/functions/v1/pluggy-webhook?t=${encodeURIComponent(token)}`
        : null,
  };
}

function errorFor(status: number): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError('PROVIDER_AUTH', status);
  }
  if (status === 404) {
    return new ProviderError('ITEM_NOT_FOUND', status);
  }
  if (status === 429) {
    return new ProviderError('RATE_LIMITED', status);
  }
  if (status >= 500) {
    return new ProviderError('PROVIDER_UNAVAILABLE', status);
  }
  return new ProviderError('PROVIDER_BAD_RESPONSE', status);
}

/** Itens que o mapeamento recusou (valor zero, data inválida…): contados, nunca registrados com o conteúdo. */
export interface PluggyStats {
  requests: number;
  invalid: number;
}

export class PluggyConnector implements BankConnector {
  readonly provider = 'pluggy' as const;
  readonly stats: PluggyStats = { requests: 0, invalid: 0 };
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private apiKey: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: PluggyConfig) {
    this.fetcher = config.fetch ?? fetch;
    this.now = config.now ?? Date.now;
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<Response> {
    this.stats.requests += 1;
    try {
      const all: Record<string, string> = { accept: 'application/json', ...headers };
      if (body !== undefined) {
        all['content-type'] = 'application/json';
      }
      return await this.fetcher(`${this.config.baseUrl}${path}`, {
        method,
        headers: all,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ProviderError('PROVIDER_UNAVAILABLE');
    }
  }

  private async readBody(response: Response): Promise<unknown> {
    if (!response.ok) {
      await response.body?.cancel();
      throw errorFor(response.status);
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    if (text === '') {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('PROVIDER_BAD_RESPONSE', response.status);
    }
  }

  /** `POST /auth` → `apiKey`, reaproveitado até perto de expirar. */
  private async key(force = false): Promise<string> {
    if (!force && this.apiKey && this.apiKey.expiresAt > this.now()) {
      return this.apiKey.value;
    }
    const response = await this.send(
      'POST',
      '/auth',
      { clientId: this.config.clientId, clientSecret: this.config.clientSecret },
      {},
    );
    const body = await this.readBody(response);
    const value = (body as { apiKey?: unknown } | null)?.apiKey;
    if (typeof value !== 'string' || value === '') {
      throw new ProviderError('PROVIDER_AUTH', response.status);
    }
    this.apiKey = { value, expiresAt: this.now() + API_KEY_TTL_MS };
    return value;
  }

  /** Chamada autenticada; um 401 renova o `apiKey` e tenta uma vez mais. */
  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    let response = await this.send(method, path, body, { 'X-API-KEY': await this.key() });
    if (response.status === 401) {
      await response.body?.cancel();
      response = await this.send(method, path, body, { 'X-API-KEY': await this.key(true) });
    }
    return this.readBody(response);
  }

  async createConnectToken(input: {
    userId: string;
    itemId?: string;
  }): Promise<{ token: string; connectorIds: number[]; expiresAt: string }> {
    const body = await this.call('POST', '/connect_token', {
      ...(input.itemId ? { itemId: input.itemId } : {}),
      options: {
        clientUserId: input.userId,
        ...(this.config.webhookUrl ? { webhookUrl: this.config.webhookUrl } : {}),
        avoidDuplicates: true,
      },
    });
    const token = (body as { accessToken?: unknown } | null)?.accessToken;
    if (typeof token !== 'string' || token === '') {
      throw new ProviderError('PROVIDER_BAD_RESPONSE');
    }
    return {
      token,
      connectorIds: [...this.config.allowedConnectorIds],
      expiresAt: new Date(this.now() + CONNECT_TOKEN_TTL_MS).toISOString(),
    };
  }

  async getItem(itemId: string): Promise<ProviderItem> {
    const body = await this.call('GET', `/items/${encodeURIComponent(itemId)}`);
    try {
      return mapItem(body);
    } catch {
      throw new ProviderError('PROVIDER_BAD_RESPONSE');
    }
  }

  /** `PATCH /items/{id}` com o `clientUserId` (item criado pela Demo do dashboard, tech §6.1.3 passo 4). */
  async setClientUserId(itemId: string, userId: string): Promise<void> {
    await this.call('PATCH', `/items/${encodeURIComponent(itemId)}`, { clientUserId: userId });
  }

  /** Lê todas as páginas de um endpoint paginado por número (`page`, `totalPages`). */
  private async allPages(path: string): Promise<unknown[]> {
    const out: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const separator = path.includes('?') ? '&' : '?';
      const parsed = PluggyPage.safeParse(
        await this.call('GET', `${path}${separator}page=${page}`),
      );
      if (!parsed.success) {
        throw new ProviderError('PROVIDER_BAD_RESPONSE');
      }
      out.push(...parsed.data.results);
      if ((parsed.data.totalPages ?? 1) <= page) {
        break;
      }
    }
    return out;
  }

  private mapEach<T>(rows: readonly unknown[], map: (raw: unknown) => T): T[] {
    const out: T[] = [];
    for (const raw of rows) {
      try {
        out.push(map(raw));
      } catch {
        this.stats.invalid += 1;
      }
    }
    return out;
  }

  async listAccounts(itemId: string): Promise<ProviderAccount[]> {
    const rows = await this.allPages(`/accounts?itemId=${encodeURIComponent(itemId)}`);
    return this.mapEach(rows, mapAccount);
  }

  /** Caminho da próxima página a partir do `next` (consulta `?…`, caminho `/…` ou URL absoluta). */
  private nextPath(next: string): string {
    if (next.startsWith('?')) {
      return `/v2/transactions${next}`;
    }
    if (next.startsWith('/')) {
      return next;
    }
    if (/^https?:\/\//.test(next)) {
      const url = new URL(next);
      return `${url.pathname}${url.search}`;
    }
    return `/v2/transactions?cursor=${encodeURIComponent(next)}`;
  }

  private async *pages(firstPath: string): AsyncGenerator<ProviderTransaction[]> {
    let path: string | null = firstPath;
    for (let page = 0; path !== null && page < MAX_PAGES; page += 1) {
      const parsed = PluggyTransactionsPage.safeParse(await this.call('GET', path));
      if (!parsed.success) {
        throw new ProviderError('PROVIDER_BAD_RESPONSE');
      }
      yield this.mapEach(parsed.data.results, mapTransaction);
      const next = parsed.data.next;
      path = next ? this.nextPath(next) : null;
    }
  }

  listTransactions(
    accountId: string,
    range: { dateFrom: ISODate; dateTo?: ISODate },
  ): AsyncIterable<ProviderTransaction[]> {
    const query = new URLSearchParams({ accountId, dateFrom: range.dateFrom });
    if (range.dateTo) {
      query.set('dateTo', range.dateTo);
    }
    return this.pages(`/v2/transactions?${query}`);
  }

  async getTransactionsByIds(accountId: string, ids: string[]): Promise<ProviderTransaction[]> {
    const out: ProviderTransaction[] = [];
    for (let i = 0; i < ids.length; i += IDS_PER_CALL) {
      const query = new URLSearchParams({
        accountId,
        ids: ids.slice(i, i + IDS_PER_CALL).join(','),
      });
      for await (const page of this.pages(`/v2/transactions?${query}`)) {
        out.push(...page);
      }
    }
    return out;
  }

  async listBills(accountId: string): Promise<ProviderBill[]> {
    const rows = await this.allPages(`/bills?accountId=${encodeURIComponent(accountId)}`);
    return this.mapEach(rows, mapBill);
  }

  /** `PATCH /items/{id}` sem corpo útil: pede atualização ao banco (limite de 20/min). */
  async requestRefresh(itemId: string): Promise<void> {
    await this.call('PATCH', `/items/${encodeURIComponent(itemId)}`, {});
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.call('DELETE', `/items/${encodeURIComponent(itemId)}`);
  }
}
