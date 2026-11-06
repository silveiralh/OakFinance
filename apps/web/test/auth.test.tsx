import type { SupabaseClient } from '@supabase/supabase-js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dexie } from 'dexie';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { AuthContext, AuthProvider, type AuthValue, useAuth } from '../src/app/auth';
import { appRoutes } from '../src/app/routes';
import { SessionExpired } from '../src/app/SessionExpired';
import { saveRow } from '../src/data/repositories/rows';
import { AuthCallback, callbackError } from '../src/features/onboarding/AuthCallback';
import { LoginScreen } from '../src/features/onboarding/LoginScreen';
import { SignOutAction } from '../src/features/settings/SignOut';
import { createSupabase } from '../src/lib/supabase';
import { fakeAuth } from './auth-fixture';
import { tx } from './data/rows';

type Listener = (event: string, session: { user: { id: string } } | null) => void;

function fakeClient(userId: string | null) {
  const listeners: Listener[] = [];
  const auth = {
    getSession: vi.fn(() =>
      Promise.resolve({ data: { session: userId ? { user: { id: userId } } : null } }),
    ),
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.push(listener);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithOAuth: vi.fn(() => Promise.resolve({ error: null })),
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    exchangeCodeForSession: vi.fn(() => Promise.resolve({ error: null })),
  };
  const client = {
    auth,
    rpc: vi.fn(() => Promise.resolve({ data: null, error: { code: 'x' }, status: 0 })),
  };
  return {
    client: client as unknown as SupabaseClient,
    auth,
    emit: (session: { user: { id: string } } | null) => {
      for (const listener of listeners) {
        listener('SIGNED_IN', session);
      }
    },
  };
}

function Probe({ onValue }: { onValue: (value: AuthValue) => void }) {
  const value = useAuth();
  onValue(value);
  return <p data-testid="status">{value.status}</p>;
}

function mount(element: React.ReactNode, auth: AuthValue, path = '/') {
  const router = createMemoryRouter([{ path: '*', element }], { initialEntries: [path] });
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return router;
}

afterEach(async () => {
  for (const name of await Dexie.getDatabaseNames()) {
    await Dexie.delete(name);
  }
});

describe('US-01: sessão e banco por usuário', () => {
  it('sessão guardada abre o banco oakfinance_<userId> sem esperar a rede; trocar de sessão troca o banco', async () => {
    const fake = fakeClient('u1');
    const box: { current: AuthValue | null } = { current: null };
    render(
      <AuthProvider client={fake.client} autoSync={false}>
        <Probe
          onValue={(v) => {
            box.current = v;
          }}
        />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedIn'));
    expect(box.current?.user?.db.name).toBe('oakfinance_u1');
    act(() => fake.emit(null));
    expect(screen.getByTestId('status')).toHaveTextContent('signedOut');
    expect(box.current?.user).toBeNull();
  });

  it('sem chave do Supabase: unconfigured, e o Google não abre', async () => {
    const box: { current: AuthValue | null } = { current: null };
    render(
      <AuthProvider client={null}>
        <Probe
          onValue={(v) => {
            box.current = v;
          }}
        />
      </AuthProvider>,
    );
    expect(screen.getByTestId('status')).toHaveTextContent('unconfigured');
    expect(await box.current?.signInWithGoogle()).toBe(false);
    expect(await box.current?.signOut('discard')).toBe(true);
    expect(await box.current?.pending()).toBe(0);
    expect(createSupabase({ supabasePublishableKey: null } as never)).toBeNull();
  });

  it('Google com PKCE e retorno em /auth/callback; "outra conta" pede a escolha de conta', async () => {
    const fake = fakeClient(null);
    const box: { current: AuthValue | null } = { current: null };
    render(
      <AuthProvider client={fake.client} autoSync={false}>
        <Probe
          onValue={(v) => {
            box.current = v;
          }}
        />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut'));
    expect(await box.current?.signInWithGoogle()).toBe(true);
    expect(fake.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    await box.current?.signInWithGoogle({ selectAccount: true });
    expect(fake.auth.signInWithOAuth).toHaveBeenLastCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    });
  });

  it('RN-100: sair sem fila apaga o banco local e encerra a sessão', async () => {
    const fake = fakeClient('u2');
    const box: { current: AuthValue | null } = { current: null };
    render(
      <AuthProvider client={fake.client} autoSync={false}>
        <Probe
          onValue={(v) => {
            box.current = v;
          }}
        />
      </AuthProvider>,
    );
    await waitFor(() => expect(box.current?.user).not.toBeNull());
    await box.current?.user?.db.open();
    expect(await Dexie.exists('oakfinance_u2')).toBe(true);
    await act(async () => {
      expect(await box.current?.signOut('discard')).toBe(true);
    });
    expect(await Dexie.exists('oakfinance_u2')).toBe(false);
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByTestId('status')).toHaveTextContent('signedOut');
  });

  it('RN-100: "Enviar e sair" sem rede não sai e mantém a fila', async () => {
    const fake = fakeClient('u3');
    const box: { current: AuthValue | null } = { current: null };
    render(
      <AuthProvider client={fake.client} autoSync={false}>
        <Probe
          onValue={(v) => {
            box.current = v;
          }}
        />
      </AuthProvider>,
    );
    await waitFor(() => expect(box.current?.user).not.toBeNull());
    const db = box.current?.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await saveRow(db, 'transactions', tx('t1'));
    expect(await box.current?.pending()).toBe(1);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await box.current?.signOut('send');
    });
    expect(ok).toBe(false);
    expect(await Dexie.exists('oakfinance_u3')).toBe(true);
    expect(fake.auth.signOut).not.toHaveBeenCalled();
  });
});

describe('guarda de rota (UX §2.2)', () => {
  it('sem sessão, as telas do app levam às boas-vindas; com sessão, a entrada leva ao Início', async () => {
    const out = createMemoryRouter(appRoutes(), { initialEntries: ['/lancamentos'] });
    render(<App router={out} auth={fakeAuth('signedOut')} />);
    await waitFor(() => expect(out.state.location.pathname).toBe('/boas-vindas'));
  });

  it('com sessão, /entrar vai ao Início (abrir sem rede não mostra login)', async () => {
    const signed = createMemoryRouter(appRoutes(), { initialEntries: ['/entrar'] });
    render(<App router={signed} auth={fakeAuth('signedIn')} />);
    await waitFor(() => expect(signed.state.location.pathname).toBe('/'));
  });

  it('carregando a sessão: abertura (S00)', () => {
    const router = createMemoryRouter(appRoutes(), { initialEntries: ['/'] });
    render(<App router={router} auth={fakeAuth('loading')} />);
    expect(screen.getByTestId('splash')).toBeInTheDocument();
    const entry = createMemoryRouter(appRoutes(), { initialEntries: ['/entrar'] });
    render(<App router={entry} auth={fakeAuth('loading')} />);
    expect(screen.getAllByTestId('splash')).toHaveLength(2);
  });
});

describe('ON03 e G14 (UX §3 ON03, RN-101)', () => {
  it('Entrar com Google: carregando "Entrando…" e erro com "Tentar novamente"', async () => {
    let resolve: (ok: boolean) => void = () => undefined;
    const auth = fakeAuth('signedOut', {
      signInWithGoogle: vi.fn(() => new Promise<boolean>((r) => (resolve = r))),
    });
    mount(<LoginScreen />, auth, '/entrar');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Entre com sua conta Google',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }));
    expect(await screen.findByRole('button', { name: /Entrando…/ })).toBeInTheDocument();
    await act(async () => resolve(false));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Não foi possível entrar com o Google. Verifique a conexão e tente novamente.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(auth.signInWithGoogle).toHaveBeenCalledTimes(2);
  });

  it('G14: "Este app é de uso privado." e "Entrar com outra conta" pede a escolha de conta', () => {
    const auth = fakeAuth('signedOut');
    mount(<LoginScreen />, auth, '/entrar?erro=privado');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Este app é de uso privado.');
    expect(alert).toHaveTextContent('Esta conta Google não tem acesso.');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com outra conta' }));
    expect(auth.signInWithGoogle).toHaveBeenCalledWith({ selectAccount: true });
  });

  it('retorno com falha mostra o erro; sem rede, o botão fica desativado com o motivo', () => {
    mount(<LoginScreen />, fakeAuth('signedOut'), '/entrar?erro=falha');
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível entrar com o Google.');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(
      screen.getAllByText('Sem conexão. O primeiro acesso precisa de internet.').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Entrar com Google/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('callback: erro do hook de cadastro vira G14; outro erro vira falha', () => {
    expect(
      callbackError(
        new URLSearchParams('error=server_error&error_description=Este+app+%C3%A9+de+uso+privado.'),
      ),
    ).toBe('privado');
    expect(callbackError(new URLSearchParams('error=access_denied'))).toBe('falha');
    expect(callbackError(new URLSearchParams('code=abc'))).toBeNull();
  });

  it('callback: troca o código pela sessão e vai ao Início; erro volta ao ON03', async () => {
    const fake = fakeClient(null);
    window.history.replaceState(null, '', '/auth/callback?code=abc');
    const router = mount(
      <AuthCallback />,
      fakeAuth('signedOut', { client: fake.client }),
      '/auth/callback',
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(fake.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    window.history.replaceState(
      null,
      '',
      '/auth/callback?error=x&error_description=Este+app+%C3%A9+de+uso+privado.',
    );
    const denied = mount(
      <AuthCallback />,
      fakeAuth('signedOut', { client: fake.client }),
      '/auth/callback',
    );
    await waitFor(() => expect(denied.state.location.search).toBe('?erro=privado'));
    window.history.replaceState(null, '', '/');
  });
});

describe('G05 e G16 (UX §3 G, US-01)', () => {
  it('G16: com fila, "Sair" pergunta; "Enviar e sair" envia e sai; sem fila sai direto', async () => {
    const signOut = vi.fn(() => Promise.resolve(true));
    const auth = fakeAuth('signedIn', { pending: vi.fn(() => Promise.resolve(3)), signOut });
    const router = mount(<SignOutAction />, auth, '/ajustes');
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(
      await screen.findByText('Há 3 alterações que ainda não foram para a nuvem.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ao sair, os dados locais deste aparelho são apagados.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enviar e sair' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(signOut).toHaveBeenCalledWith('send');
  });

  it('G16: "Enviar e sair" sem conseguir enviar mantém o aviso; "Sair e descartar" sai', async () => {
    const signOut = vi.fn((mode: 'send' | 'discard') => Promise.resolve(mode === 'discard'));
    const auth = fakeAuth('signedIn', { pending: vi.fn(() => Promise.resolve(2)), signOut });
    const router = mount(<SignOutAction />, auth, '/ajustes');
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar e sair' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith('send'));
    expect(router.state.location.pathname).toBe('/ajustes');
    fireEvent.click(await screen.findByRole('button', { name: 'Sair e descartar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
  });

  it('sem fila, "Sair" sai direto', async () => {
    const auth = fakeAuth('signedIn');
    const router = mount(<SignOutAction />, auth, '/ajustes');
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(auth.signOut).toHaveBeenCalledWith('discard');
  });

  it('G05: sessão expirada mostra o aviso com "Entrar com Google" e mantém a fila', async () => {
    const auth = fakeAuth('signedIn');
    const engine = auth.user?.engine;
    vi.spyOn(engine as NonNullable<typeof engine>, 'getSnapshot').mockReturnValue({
      phase: 'auth',
      pending: 2,
      rejected: 0,
      consecutiveFailures: 0,
      showErrorBanner: false,
      lastSyncAt: null,
    });
    mount(<SessionExpired />, auth);
    expect(await screen.findByText('Sua sessão expirou.')).toBeInTheDocument();
    expect(
      screen.getByText('Entre novamente para sincronizar. Nenhum lançamento foi perdido.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Google' }));
    expect(auth.signInWithGoogle).toHaveBeenCalled();
  });
});
