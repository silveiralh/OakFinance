// T-094: Excluir minha conta e dados na S10 (US-61; UX §6.6): backup oferecido antes, orientação do Meu Pluggy,
// confirmação digitando EXCLUIR, chamada da `account-delete` e saída com a cópia local apagada.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import { DeleteAccountCard } from '../src/features/settings/DeleteAccountCard';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

function withClient(response: { data: unknown; error: unknown }) {
  const invoke = vi.fn(() => Promise.resolve(response));
  const auth = fakeAuth('signedIn', {
    client: { functions: { invoke } } as unknown as AuthValue['client'],
  });
  return { auth, invoke };
}

function mount(auth: AuthValue, onBackup = vi.fn(() => Promise.resolve())) {
  const router = createMemoryRouter(
    [
      { path: '/ajustes/dados', element: <DeleteAccountCard onBackup={onBackup} /> },
      { path: '/entrar', element: <p>entrar</p> },
    ],
    { initialEntries: ['/ajustes/dados'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  return { router, onBackup };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('US-61: excluir minha conta', () => {
  it('US-61: oferece o backup e lembra do Meu Pluggy antes de excluir', () => {
    const { auth } = withClient({ data: { ok: true }, error: null });
    const { onBackup } = mount(auth);
    expect(screen.getByText('Excluir minha conta e dados')).toBeDefined();
    expect(
      screen.getByText('Se você conectou bancos, revogue também o acesso pelo Meu Pluggy.'),
    ).toBeDefined();
    fireEvent.click(screen.getByTestId('delete-account-backup'));
    expect(onBackup).toHaveBeenCalledTimes(1);
  });

  it('US-61: só com EXCLUIR digitado; chama a account-delete, apaga a cópia local e vai para /entrar', async () => {
    const { auth, invoke } = withClient({ data: { ok: true }, error: null });
    const { router } = mount(auth);
    fireEvent.click(screen.getByTestId('delete-account-open'));
    expect(
      await screen.findByText(
        'Todos os seus lançamentos, contas e conexões serão excluídos do aparelho e da nuvem. Esta ação não pode ser desfeita. Digite EXCLUIR para confirmar.',
      ),
    ).toBeDefined();
    const run = screen.getByTestId('delete-account-run');
    fireEvent.change(screen.getByLabelText('Digite EXCLUIR para confirmar'), {
      target: { value: 'excluir' },
    });
    expect(run).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(run);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Digite EXCLUIR para confirmar'), {
      target: { value: 'EXCLUIR' },
    });
    fireEvent.click(screen.getByTestId('delete-account-run'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(invoke).toHaveBeenCalledWith(
      'account-delete',
      expect.objectContaining({ body: { confirm: 'EXCLUIR' } }),
    );
    expect(auth.signOut).toHaveBeenCalledWith('discard');
  });

  it('US-61: falha do serviço mostra o aviso e não sai', async () => {
    const { auth } = withClient({ data: null, error: new Error('500') });
    const { router } = mount(auth);
    fireEvent.click(screen.getByTestId('delete-account-open'));
    fireEvent.change(await screen.findByLabelText('Digite EXCLUIR para confirmar'), {
      target: { value: 'EXCLUIR' },
    });
    fireEvent.click(screen.getByTestId('delete-account-run'));
    expect(await screen.findByTestId('delete-account-error')).toHaveTextContent(
      'Não foi possível excluir a conta agora. Tente novamente.',
    );
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/ajustes/dados');
  });

  it('US-61: sem rede, nem tenta', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const { auth, invoke } = withClient({ data: { ok: true }, error: null });
    mount(auth);
    fireEvent.click(screen.getByTestId('delete-account-open'));
    fireEvent.change(await screen.findByLabelText('Digite EXCLUIR para confirmar'), {
      target: { value: 'EXCLUIR' },
    });
    fireEvent.click(screen.getByTestId('delete-account-run'));
    expect(await screen.findByTestId('delete-account-error')).toHaveTextContent(
      'Sem conexão. Para excluir a conta é preciso estar com internet.',
    );
    expect(invoke).not.toHaveBeenCalled();
  });
});
