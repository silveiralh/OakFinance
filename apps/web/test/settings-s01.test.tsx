// T-125 (UXC-004, D-096 item 2): Configurações em grupos com título, linhas que levam às subtelas, valor atual à
// direita quando houver e "Sair" separado no fim.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { SettingsScreen } from '../src/features/settings/screens';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

function mount() {
  const router = createMemoryRouter(
    [
      { path: '/ajustes', element: <SettingsScreen /> },
      { path: '/ajustes/*', element: <p>subtela</p> },
    ],
    { initialEntries: ['/ajustes'] },
  );
  render(
    <AuthContext.Provider value={fakeAuth('signedIn')}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  return router;
}

afterEach(() => {
  window.localStorage.clear();
});

describe('T-125: S01 em grupos (UXC-004)', () => {
  it('US-57 (D-096): grupos com título na ordem, Diagnóstico e Refazer no fim e "Sair" separado', () => {
    mount();
    const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      'Dinheiro e orçamento',
      'Avisos',
      'Dados e importação',
      'Conta e aparelho',
      'Ajuda e sobre',
    ]);
    const money = screen.getByTestId('settings-money');
    expect(
      within(money)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Contas e cartões', 'Categorias', 'Renda e contas fixas', 'Cálculo e orçamento']);
    const help = screen.getByRole('region', { name: 'Ajuda e sobre' });
    expect(within(help).getByRole('button', { name: 'Diagnóstico' })).toBeInTheDocument();
    expect(
      within(help).getByRole('button', { name: 'Refazer configuração inicial' }),
    ).toBeInTheDocument();
    expect(within(help).queryByRole('button', { name: 'Sair' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });

  it('US-57 (UXC-004): a linha mostra o valor atual (tema) e leva à subtela', async () => {
    window.localStorage.setItem('oak.env', JSON.stringify({ theme: 'dark' }));
    const router = mount();
    const row = within(screen.getByTestId('settings-device')).getByRole('button');
    expect(row).toHaveTextContent('AparênciaEscuro');
    fireEvent.click(screen.getByRole('button', { name: 'Contas e cartões' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes/contas'));
  });
});
