// T-067: erros com saída (US-64, RN-96, RN-100) — tabela da UX §6.6, textos dos estados globais da US-64, G09 com
// código curto e G13 (Edge Function sem resposta em 15 s).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorCode } from '../src/app/errorCode';
import { ScreenErrorView } from '../src/app/ScreenError';
import { errorStates, fill, shellText } from '../src/i18n/pt-BR';
import { FUNCTION_TIMEOUT_MS, invokeFunction } from '../src/lib/functions';
import { sendTestPush } from '../src/lib/push';

const here = dirname(fileURLToPath(import.meta.url));
const ux = readFileSync(join(here, '../../../docs/specs/03-ux-design-system.md'), 'utf8');

function uxErrorRows() {
  const section = ux.slice(ux.indexOf('### 6.6 '), ux.indexOf('### 6.7 '));
  return section
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Situação') && !l.startsWith('|---'))
    .map((l) => {
      const [, text = '', action = ''] = l
        .replace(/^\|\s*|\s*\|\s*$/g, '')
        .split(' | ')
        .map((c) => c.trim());
      return { text, action: action === '—' ? null : action.replace(/\*\*/g, '') };
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('UX §6.6', () => {
  it('textos e ações dos erros iguais aos da tabela, na mesma ordem', () => {
    expect(Object.values(errorStates)).toEqual(uxErrorRows());
  });
});

describe('US-64: erros conhecidos', () => {
  it.each([
    [
      'sem rede (G01)',
      shellText.offlineBanner,
      'Sem conexão. Você pode continuar lançando; tudo fica salvo no aparelho.',
    ],
    [
      'sincronização falhou (G04)',
      fill(shellText.syncFailedMany, { n: 3 }),
      '3 lançamentos não foram sincronizados. Eles continuam salvos no aparelho.',
    ],
    [
      'sessão expirada (G05)',
      errorStates.sessionExpired.text,
      'Sua sessão expirou. Entre novamente para sincronizar. Nenhum lançamento foi perdido.',
    ],
    [
      'armazenamento cheio (G11)',
      shellText.storageFull,
      'O armazenamento do aparelho está cheio. Libere espaço para continuar lançando.',
    ],
    [
      'IndexedDB indisponível (G12)',
      shellText.storageBlocked,
      'Este navegador bloqueou o armazenamento local. Abra pelo app instalado.',
    ],
    [
      'erro inesperado na tela (G09)',
      errorStates.screenError.text,
      'Não foi possível carregar esta tela. Seus dados estão seguros.',
    ],
    [
      'Edge Function sem resposta em 15 s (G13)',
      shellText.serviceSlow,
      'O serviço demorou para responder. Tente novamente.',
    ],
  ])('US-64: %s', (_situacao, texto, esperado) => {
    expect(texto).toBe(esperado);
  });

  it('US-64 (G09): "Tentar novamente" e um código curto do erro', () => {
    const code = errorCode(new TypeError('x is undefined'));
    expect(code).toMatch(/^E-[0-9A-Z]{6}$/);
    expect(errorCode({ status: 503, statusText: '', data: null, internal: false })).toBe('R-503');
    const retry = vi.fn();
    render(<ScreenErrorView error={new TypeError('x is undefined')} onRetry={retry} />);
    expect(screen.getByText(shellText.screenErrorTitle)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(code))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('G13: Edge Function com prazo de 15 s', () => {
  const client = (invoke: () => Promise<unknown>) =>
    ({ functions: { invoke } }) as unknown as Pick<SupabaseClient, 'functions'>;

  it('US-64 (G13): sem resposta em 15 s, aborta e devolve timeout', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const invoke = vi.fn((_name: string, opts: { signal: AbortSignal }) => {
      signal = opts.signal;
      return new Promise(() => undefined);
    });
    const pending = invokeFunction(
      client(invoke as never),
      'push-test',
      {},
      { isOnline: () => true },
    );
    await vi.advanceTimersByTimeAsync(FUNCTION_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, reason: 'timeout' });
    expect(signal?.aborted).toBe(true);
    expect(FUNCTION_TIMEOUT_MS).toBe(15_000);
  });

  it('sem rede não chama; erro da função vira failed; resposta volta como dado', async () => {
    const never = vi.fn();
    expect(
      await invokeFunction(client(never as never), 'x', {}, { isOnline: () => false }),
    ).toEqual({
      ok: false,
      reason: 'offline',
    });
    expect(never).not.toHaveBeenCalled();
    const failed = () => Promise.resolve({ data: null, error: new Error('500') });
    expect(await invokeFunction(client(failed), 'x', {}, { isOnline: () => true })).toEqual({
      ok: false,
      reason: 'failed',
    });
    const thrown = () => Promise.reject(new Error('rede'));
    expect(await invokeFunction(client(thrown), 'x', {}, { isOnline: () => true })).toEqual({
      ok: false,
      reason: 'failed',
    });
    const okay = () => Promise.resolve({ data: { sent: 2 }, error: null });
    expect(await invokeFunction(client(okay), 'x', {}, { isOnline: () => true })).toEqual({
      ok: true,
      data: { sent: 2 },
    });
  });

  it('US-64 (G13): a notificação de teste da S07 distingue o tempo esgotado das outras falhas', async () => {
    const slow = {
      functions: { invoke: () => new Promise(() => undefined) },
    } as unknown as SupabaseClient;
    expect(await sendTestPush(slow, { timeoutMs: 5, isOnline: () => true })).toBe('timeout');
    const broken = {
      functions: { invoke: () => Promise.resolve({ data: null, error: new Error('x') }) },
    } as unknown as SupabaseClient;
    expect(await sendTestPush(broken, { isOnline: () => true })).toBeNull();
    const fine = {
      functions: { invoke: () => Promise.resolve({ data: { sent: 2 }, error: null }) },
    } as unknown as SupabaseClient;
    expect(await sendTestPush(fine, { isOnline: () => true })).toBe(2);
  });
});
