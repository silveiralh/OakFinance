// Fronteira do sync com o servidor: as RPCs `sync_push`, `sync_pull` e `log_events` (tech §4.7) e a sessão. O
// motor só conhece esta interface; `fromSupabase` adapta o cliente do supabase-js (T-034 cria o cliente).

export interface RpcError {
  code?: string;
  message?: string;
}

export interface RpcResponse<T> {
  data: T | null;
  error: RpcError | null;
  /** Status HTTP (0 = sem resposta). */
  status?: number;
}

export type RpcName = 'sync_push' | 'sync_pull' | 'log_events';

export interface SyncTransport {
  /** Garante sessão válida (renova o token se preciso). `false`: sem sessão, o sync espera o login. */
  hasSession(): Promise<boolean>;
  rpc<T>(
    name: RpcName,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<RpcResponse<T>>;
}

/** Tempo máximo de cada chamada (tech §4.5, passo 6). */
export const RPC_TIMEOUT_MS = 15_000;

export type FailureKind = 'retry' | 'auth' | 'fatal';

/**
 * Classe da falha: rede, timeout e 5xx tentam de novo com backoff; 401 (ou `28000`/JWT) espera o novo login
 * (G05); o resto (4xx de contrato) é bug e também tenta de novo, mas é registrado como erro.
 */
export function classifyFailure(
  response: Pick<RpcResponse<unknown>, 'error' | 'status'>,
): FailureKind {
  const status = response.status ?? 0;
  const code = response.error?.code ?? '';
  if (status === 401 || code === '28000' || code === 'PGRST301' || code === 'PGRST303') {
    return 'auth';
  }
  if (status === 0 || status >= 500 || status === 408 || status === 429) {
    return 'retry';
  }
  return 'fatal';
}

export class RpcFailure extends Error {
  override name = 'RpcFailure';
  constructor(
    readonly kind: FailureKind,
    readonly code: string,
  ) {
    super(`RPC falhou (${kind}): ${code}`);
  }
}

/** Chama a RPC com timeout de 15 s; falha vira `RpcFailure` com a classe certa. */
export async function callRpc<T>(
  transport: SyncTransport,
  name: RpcName,
  args: Record<string, unknown>,
  timeoutMs: number = RPC_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: RpcResponse<T>;
  try {
    response = await Promise.race([
      transport.rpc<T>(name, args, controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new RpcFailure('retry', 'TIMEOUT')),
        );
      }),
    ]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new RpcFailure('retry', 'TIMEOUT');
    }
    throw error instanceof RpcFailure ? error : new RpcFailure('retry', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  if (response.error) {
    throw new RpcFailure(
      classifyFailure(response),
      response.error.code || `HTTP_${response.status ?? 0}`,
    );
  }
  // RPCs `void` (log_events) devolvem `null`; quem chama valida o formato da resposta
  return response.data as T;
}

interface SupabaseLike {
  auth: { getSession(): Promise<{ data: { session: unknown } }> };
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null; status: number }> & {
    abortSignal?(
      signal: AbortSignal,
    ): PromiseLike<{ data: unknown; error: RpcError | null; status: number }>;
  };
}

/** Adapta o cliente do supabase-js. */
export function fromSupabase(client: SupabaseLike): SyncTransport {
  return {
    async hasSession() {
      const { data } = await client.auth.getSession();
      return data.session !== null;
    },
    async rpc<T>(name: RpcName, args: Record<string, unknown>, signal: AbortSignal) {
      const builder = client.rpc(name, args);
      const response = await (builder.abortSignal ? builder.abortSignal(signal) : builder);
      return response as RpcResponse<T>;
    },
  };
}
