// T-063: ativar notificações push (US-38, tech §6.4.1–6.4.2), com Notification e PushManager simulados.
import type { SupabaseClient } from '@supabase/supabase-js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { RemindersScreen, statusText } from '../src/features/settings/RemindersScreen';
import { baseState, keyBytes, type PushEnvironment, platformOf } from '../src/lib/push';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

// chave pública de teste (65 bytes, formato não comprimido; não é segredo)
const KEY = `BA${'A'.repeat(85)}`;

vi.mock('../src/lib/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/env')>();
  return { ...original, getEnv: () => ({ vapidPublicKey: KEY }) };
});

const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1';

function env(over: Partial<PushEnvironment> = {}): PushEnvironment {
  return {
    userAgent: ANDROID,
    maxTouchPoints: 5,
    standalone: false,
    hasPushManager: true,
    hasServiceWorker: true,
    hasNotification: true,
    permission: 'default',
    ...over,
  };
}

describe('suporte e estado (tech §6.4.1)', () => {
  it('plataforma pelo user agent (iPad em modo computador conta como iPhone)', () => {
    expect(platformOf(IPHONE)).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('ios');
    expect(platformOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe('desktop');
    expect(platformOf(ANDROID)).toBe('android');
    expect(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('desktop');
    expect(platformOf('curl/8')).toBe('other');
  });

  it('US-38: iPhone fora da Tela de Início → guia; sem PushManager → sem suporte; sem chave → indisponível', () => {
    expect(baseState(env({ userAgent: IPHONE }), KEY)).toBe('ios-not-installed');
    expect(baseState(env({ userAgent: IPHONE, standalone: true }), KEY)).toBe('off');
    expect(baseState(env({ hasPushManager: false }), KEY)).toBe('unsupported');
    expect(baseState(env(), null)).toBe('unconfigured');
    expect(baseState(env({ permission: 'denied' }), KEY)).toBe('denied');
  });

  it('chave VAPID base64url vira os bytes do applicationServerKey', () => {
    expect(keyBytes(KEY)).toHaveLength(65);
  });

  it('US-38: permissão negada explica como reativar no Android, no iPhone e no computador', () => {
    expect(statusText('denied', env(), false)).toMatch(
      /^Notificações bloqueadas\. Para reativar, toque no cadeado/,
    );
    expect(statusText('denied', env({ userAgent: IPHONE, standalone: true }), false)).toBe(
      'Notificações bloqueadas. No iPhone, abra Ajustes › Notificações › OakFinance e ative Permitir Notificações.',
    );
    expect(
      statusText('denied', env({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), false),
    ).toMatch(/clique no cadeado/);
    expect(statusText('off', env({ permission: 'granted' }), true)).toBe(
      'Os lembretes deste aparelho pararam. Ative de novo para voltar a recebê-los.',
    );
  });
});

describe('S07 — Lembretes (US-38)', () => {
  const subscription = {
    endpoint: 'https://push.example.test/sub/1',
    toJSON: () => ({ keys: { p256dh: 'p256', auth: 'auth' } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
  let current: typeof subscription | null = null;
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(current)),
    subscribe: vi.fn(() => {
      current = subscription;
      return Promise.resolve(subscription);
    }),
  };

  beforeEach(() => {
    current = null;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({ pushManager }),
        addEventListener() {},
        removeEventListener() {},
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function mount(environment: PushEnvironment) {
    const rpc = vi.fn(() => Promise.resolve({ data: 'id', error: null }));
    const invoke = vi.fn(() => Promise.resolve({ data: { sent: 1 }, error: null }));
    const client = { rpc, functions: { invoke } } as unknown as SupabaseClient;
    const auth = fakeAuth('signedIn', { client });
    const router = createMemoryRouter([
      { path: '*', element: <RemindersScreen environment={environment} /> },
    ]);
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    return { rpc, invoke };
  }

  it('US-38: permitir salva a inscrição deste aparelho e manda a notificação de teste', async () => {
    vi.stubGlobal('Notification', { requestPermission: vi.fn(() => Promise.resolve('granted')) });
    const { rpc, invoke } = mount(env());
    expect(screen.getByTestId('push-state')).toHaveTextContent(
      'Lembretes desativados neste aparelho.',
    );
    expect(screen.getByText('Os avisos continuam na central.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar lembretes' }));
    await waitFor(() =>
      expect(screen.getByTestId('push-state')).toHaveTextContent(
        'Lembretes ativos neste aparelho.',
      ),
    );
    expect(pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    expect(rpc).toHaveBeenCalledWith(
      'upsert_push_subscription',
      expect.objectContaining({
        p_endpoint: 'https://push.example.test/sub/1',
        p_p256dh: 'p256',
        p_auth: 'auth',
      }),
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('push-test', { body: {} }));
    expect(await screen.findByText('Lembretes ativados.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar notificação de teste' })).toBeInTheDocument();
  });

  it('US-38: negar mostra como reativar (Android) e não inscreve', async () => {
    vi.stubGlobal('Notification', { requestPermission: vi.fn(() => Promise.resolve('denied')) });
    mount(env());
    fireEvent.click(screen.getByRole('button', { name: 'Ativar lembretes' }));
    await waitFor(() =>
      expect(screen.getByTestId('push-state')).toHaveTextContent(/^Notificações bloqueadas\./),
    );
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Ativar lembretes' })).toBeNull();
  });

  it('US-38: iPhone no Safari sem instalar não mostra "Ativar lembretes" e leva ao guia', () => {
    mount(env({ userAgent: IPHONE }));
    expect(screen.getByTestId('push-state')).toHaveTextContent(
      'Instale o app para receber lembretes',
    );
    expect(screen.getByRole('link', { name: 'Ver como instalar' })).toHaveAttribute(
      'href',
      '/instalar',
    );
    expect(screen.queryByRole('button', { name: 'Ativar lembretes' })).toBeNull();
  });

  it('com inscrição existente abre como ativo; teste e desativar chamam a função e a RPC', async () => {
    current = subscription;
    const { rpc, invoke } = mount(env({ permission: 'granted' }));
    await waitFor(() =>
      expect(screen.getByTestId('push-state')).toHaveTextContent(
        'Lembretes ativos neste aparelho.',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar notificação de teste' }));
    expect(await screen.findByText('Notificação de teste enviada.')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar neste aparelho' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('delete_push_subscription', {
        p_endpoint: 'https://push.example.test/sub/1',
      }),
    );
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it('sem suporte a push: explica e mantém a central', () => {
    mount(env({ hasPushManager: false }));
    expect(screen.getByTestId('push-state')).toHaveTextContent(
      'Este navegador não recebe notificações.',
    );
    expect(screen.getByText('Os avisos continuam na central.')).toBeInTheDocument();
  });
});
