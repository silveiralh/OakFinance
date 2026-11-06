import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import { Amount, HideValuesButton, maskMoney, ValuesFromProfile } from '../src/app/values';
import { describeChanges } from '../src/features/transactions/history';
import { methodLabel, TransactionsScreen } from '../src/features/transactions/TransactionsScreen';
import { ENV_STORAGE_KEY, setEnvironmentPrefs } from '../src/lib/environment';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-06';

function mount(auth: AuthValue, ui: React.ReactNode) {
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: ['/'] });
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  setEnvironmentPrefs({ values: 'shown' });
  localStorage.clear();
});

describe('ocultar valores (US-57, RN-103)', () => {
  it('US-57: o olho alterna com aria-pressed, grava no aparelho e na conta', async () => {
    const auth = fakeAuth('signedIn');
    const user = auth.user;
    if (!user) {
      throw new Error('sem usuário');
    }
    await user.db.profiles.put(
      makeRow('profiles', { id: user.userId, settings: { theme: 'light' } }),
    );
    mount(auth, <HideValuesButton />);
    const button = await screen.findByRole('button', { name: 'Ocultar valores' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    const shown = await screen.findByRole('button', { name: 'Mostrar valores' });
    expect(shown).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.getAttribute('data-values')).toBe('hidden');
    expect(JSON.parse(localStorage.getItem(ENV_STORAGE_KEY) ?? '{}')).toMatchObject({
      values: 'hidden',
    });
    await waitFor(async () =>
      expect((await user.db.profiles.get(user.userId))?.settings).toEqual({
        theme: 'light',
        hideValues: true,
      }),
    );
    fireEvent.click(shown);
    await waitFor(() => expect(document.documentElement.getAttribute('data-values')).toBe('shown'));
  });

  it('US-57: a preferência da conta vale neste aparelho quando o perfil chega', async () => {
    const auth = fakeAuth('signedIn');
    const user = auth.user;
    if (!user) {
      throw new Error('sem usuário');
    }
    mount(auth, <ValuesFromProfile />);
    expect(document.documentElement.getAttribute('data-values')).not.toBe('hidden');
    await act(() =>
      user.db.profiles.put(
        makeRow('profiles', { id: user.userId, settings: { hideValues: true } }),
      ),
    );
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-values')).toBe('hidden'),
    );
  });

  it('RN-103: "R$ ••••" na tela e "Valor oculto" para o leitor de tela', () => {
    expect(maskMoney('R$ 10,00', true)).toBe('R$ ••••');
    expect(maskMoney('R$ 10,00', false)).toBe('R$ 10,00');
    const { container, rerender } = render(<Amount text="R$ 10,00" hidden={false} />);
    expect(container).toHaveTextContent('R$ 10,00');
    rerender(<Amount text="R$ 10,00" hidden />);
    expect(container).toHaveTextContent('R$ ••••Valor oculto');
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent('R$ ••••');
  });

  it('E13: com valores ocultos a T01 não mostra nenhum "R$ <dígito>"', async () => {
    setEnvironmentPrefs({ values: 'hidden' });
    const auth = fakeAuth('signedIn');
    await auth.user?.db.transactions.put(
      tx('t1', {
        description: 'Padaria',
        amount_cents: 4590,
        deleted_at: null,
        occurred_on: TODAY,
      }),
    );
    mount(auth, <TransactionsScreen today={TODAY} />);
    expect(await screen.findByTestId('tx-t1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Despesas' }));
    expect(await screen.findByTestId('list-total')).toHaveTextContent('Total filtrado: R$ ••••');
    expect(document.body.textContent).not.toMatch(/R\$\s?\d/);
  });

  it('RN-103: o histórico também mascara os valores', () => {
    const names = {
      categories: new Map(),
      accounts: new Map(),
      cards: new Map(),
      method: methodLabel,
      hidden: true,
    };
    expect(describeChanges({ amount_cents: 4590 }, { amount_cents: 4950 }, names)).toEqual([
      'Valor alterado de R$ •••• para R$ ••••',
    ]);
  });
});
