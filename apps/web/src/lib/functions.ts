// Chamada de Edge Function com prazo (US-64, G13): sem resposta em 15 s, a chamada é abortada e a tela mostra
// "O serviço demorou para responder. Tente novamente." com a opção de repetir. Sem rede, nem tenta.
import type { SupabaseClient } from '@supabase/supabase-js';

export const FUNCTION_TIMEOUT_MS = 15_000;

export type InvokeFailure = 'timeout' | 'offline' | 'failed';
export type InvokeResult<T> = { ok: true; data: T } | { ok: false; reason: InvokeFailure };

export interface InvokeOptions {
  timeoutMs?: number;
  isOnline?: () => boolean;
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
    return outcome.error || outcome.data === null
      ? { ok: false, reason: 'failed' }
      : { ok: true, data: outcome.data };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
