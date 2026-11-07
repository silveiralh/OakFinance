// Mock da API da Pluggy para E2E e integração (tech §8.2), servindo as fixtures PROVISÓRIAS de
// `scripts/fixtures/pluggy/sandbox.json`. Roda no Deno (`deno run -A scripts/mock-pluggy.ts`, porta 54400).
// Simula: `POST /auth`, `POST /connect_token`, `GET|PATCH|DELETE /items/{id}`, `GET /accounts?itemId`,
// `GET /v2/transactions` (cursor em `next`, página configurável), `GET /bills` (por página), o item com
// `LOGIN_ERROR` e a transação que some e volta com id novo (`POST /__mock/reissue`). Não existe `GET /transactions`.
import sandbox from './fixtures/pluggy/sandbox.json' with { type: 'json' };

const PORT = 54400;
export const MOCK_API_KEY = 'mock-api-key';
export const MOCK_CONNECT_TOKEN = 'mock-connect-token';

type Json = Record<string, unknown>;

interface State {
  items: Map<string, Json>;
  transactions: Json[];
  pageSize: number;
  reissued: boolean;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Estado novo a partir das fixtures (cada teste pode ter o seu). */
export function createState(pageSize = 2): State {
  return {
    items: new Map((sandbox.items as Json[]).map((item) => [String(item.id), clone(item)])),
    transactions: clone(sandbox.transactions as Json[]),
    pageSize,
    reissued: false,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function notFound(): Response {
  return json({ code: 404, message: 'rota não simulada' }, 404);
}

async function body(request: Request): Promise<Json> {
  try {
    const value = await request.json();
    return value !== null && typeof value === 'object' ? (value as Json) : {};
  } catch {
    return {};
  }
}

/** Página por número (formato dos endpoints `/accounts` e `/bills`). */
function numbered(rows: unknown[], url: URL, size: number): Response {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  return json({
    total: rows.length,
    totalPages,
    page,
    results: rows.slice((page - 1) * size, page * size),
  });
}

function transactionsPage(state: State, url: URL): Response {
  const accountId = url.searchParams.get('accountId');
  if (!accountId) {
    return json({ code: 400, message: 'accountId é obrigatório' }, 400);
  }
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean) ?? null;
  const rows = state.transactions
    .filter((tx) => tx.accountId === accountId)
    .filter((tx) => (ids ? ids.includes(String(tx.id)) : true))
    .filter((tx) => !dateFrom || String(tx.date).slice(0, 10) >= dateFrom)
    .filter((tx) => !dateTo || String(tx.date).slice(0, 10) <= dateTo)
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)),
    );
  const offset = Number(url.searchParams.get('cursor') ?? '0') || 0;
  const results = rows.slice(offset, offset + state.pageSize);
  let next: string | null = null;
  if (offset + state.pageSize < rows.length) {
    const query = new URLSearchParams(url.searchParams);
    query.set('cursor', String(offset + state.pageSize));
    next = `?${query}`;
  }
  return json({ results, next });
}

/** Atende uma requisição com o estado dado (padrão: um estado do processo). */
export async function handle(request: Request, state: State = defaultState): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/health') {
    return json({ status: 'ok' });
  }
  if (method === 'POST' && pathname === '/__mock/reissue') {
    // tech §6.1.1: a transação some e volta com id novo
    if (!state.reissued) {
      state.transactions = state.transactions.filter((tx) => tx.id !== sandbox.reissue.deleted);
      state.transactions.push(clone(sandbox.reissue.created as Json));
      state.reissued = true;
    }
    return json({ deleted: sandbox.reissue.deleted, created: sandbox.reissue.created.id });
  }
  if (method === 'POST' && pathname === '/auth') {
    const credentials = await body(request);
    if (!credentials.clientId || !credentials.clientSecret) {
      return json({ code: 401, message: 'credenciais inválidas' }, 401);
    }
    return json({ apiKey: MOCK_API_KEY });
  }
  if (request.headers.get('x-api-key') !== MOCK_API_KEY) {
    return json({ code: 401, message: 'X-API-KEY ausente ou inválida' }, 401);
  }
  if (method === 'POST' && pathname === '/connect_token') {
    const input = await body(request);
    if (input.itemId !== undefined && !state.items.has(String(input.itemId))) {
      return json({ code: 404, message: 'item não encontrado' }, 404);
    }
    return json({ accessToken: MOCK_CONNECT_TOKEN });
  }
  if (method === 'GET' && pathname === '/connectors') {
    return json({ total: sandbox.connectors.length, results: sandbox.connectors });
  }
  const itemMatch = /^\/items\/([^/]+)$/.exec(pathname);
  if (itemMatch) {
    const id = decodeURIComponent(itemMatch[1] ?? '');
    const item = state.items.get(id);
    if (!item) {
      return json({ code: 404, message: 'item não encontrado' }, 404);
    }
    if (method === 'GET') {
      return json(item);
    }
    if (method === 'PATCH') {
      const patch = await body(request);
      if (typeof patch.clientUserId === 'string') {
        item.clientUserId = patch.clientUserId;
      }
      if (item.status !== 'LOGIN_ERROR') {
        item.status = 'UPDATING';
      }
      return json(item);
    }
    if (method === 'DELETE') {
      state.items.delete(id);
      return new Response(null, { status: 204 });
    }
  }
  if (method === 'GET' && pathname === '/accounts') {
    const itemId = url.searchParams.get('itemId');
    if (!itemId || !state.items.has(itemId)) {
      return json({ code: 404, message: 'item não encontrado' }, 404);
    }
    const rows = (sandbox.accounts as Json[]).filter((a) => a.itemId === itemId);
    return numbered(rows, url, 20);
  }
  if (method === 'GET' && pathname === '/v2/transactions') {
    return transactionsPage(state, url);
  }
  if (method === 'GET' && pathname === '/bills') {
    const accountId = url.searchParams.get('accountId');
    const rows = (sandbox.bills as Json[]).filter((b) => b.accountId === accountId);
    return numbered(rows, url, 1);
  }
  return notFound();
}

const defaultState = createState();

if (import.meta.main) {
  Deno.serve({ port: PORT, hostname: '127.0.0.1' }, (request) => handle(request));
}
