// Chamada de Edge Function com prazo (US-64, G13): sem resposta em 15 s, a chamada é abortada e a tela mostra
// "O serviço demorou para responder. Tente novamente." com a opção de repetir. Sem rede, nem tenta.
import type { SupabaseClient } from '@supabase/supabase-js';

export const FUNCTION_TIMEOUT_MS = 15_000;

export type InvokeFailure = 'timeout' | 'offline' | 'failed';
export type InvokeResult<T> =
  | { ok: true; data: T }
  /** `code`: o código estável do corpo `{ error: { code } }` da função (tech §6.0), quando veio. */
  | { ok: false; reason: InvokeFailure; code?: string };

export interface InvokeOptions {
  timeoutMs?: number;
  isOnline?: () => boolean;
}

/** Código de erro do corpo da resposta (`FunctionsHttpError.context` é a `Response`). */
async function errorCode(error: unknown): Promise<string | undefined> {
  const context = (error as { context?: unknown } | null)?.context as
    | { clone?: () => { json(): Promise<unknown> } }
    | undefined;
  if (typeof context?.clone !== 'function') {
    return undefined;
  }
  try {
    const body = (await context.clone().json()) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Invoca `name` com `body`; nunca lança. A região é a de São Paulo (tech §6.0). */
export async function invokeFunction<T>(
  client: Pick<SupabaseClient, 'functions'>,
  name: string,
  body: Record<string, unknown> = {},
  {
    timeoutMs = FUNCTION_TIMEOUT_MS,
    isOnline = () => globalThis.navigator?.onLine !== false,
  }: InvokeOptions = {},
): Promise<InvokeResult<T>> {
  if (!isOnline()) {
    return { ok: false, reason: 'offline' };
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, timeoutMs);
  });
  try {
    const outcome = await Promise.race([
      client.functions.invoke<T>(name, { body, signal: controller.signal }),
      expired,
    ]);
    if (outcome === 'timeout') {
      return { ok: false, reason: 'timeout' };
    }
    if (outcome.error) {
      const code = await errorCode(outcome.error);
      return code ? { ok: false, reason: 'failed', code } : { ok: false, reason: 'failed' };
    }
    return outcome.data === null
      ? { ok: false, reason: 'failed' }
      : { ok: true, data: outcome.data };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
