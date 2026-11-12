// T-068: S08 Aparência (US-58) — tema, transparência, movimento e "Abrir com valores ocultos", gravados no aparelho
// (oak.env + atributos data-*) e na conta (profiles.settings).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import {
  AppearanceScreen,
  appearanceOf,
  profilePatch,
} from '../src/features/settings/AppearanceScreen';
import { ENV_STORAGE_KEY } from '../src/lib/environment';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

afterEach(() => {
  localStorage.clear();
  for (const name of ['data-theme', 'data-glass', 'data-motion', 'data-values']) {
    document.documentElement.removeAttribute(name);
  }
});

async function mount(): Promise<AuthValue> {
  const auth = fakeAuth();
  const user = auth.user;
  if (!user) {
    throw new Error('sem sessão');
  }
  await user.db.profiles.put(
    makeRow('profiles', {
      id: user.userId,
      user_id: user.userId,
      settings: { spendable: { savingsMode: 'target' } },
      onboarding: {},
      timezone: 'America/Sao_Paulo',
      deleted_at: null,
    }),
  );
  const router = createMemoryRouter([{ path: '*', element: <AppearanceScreen /> }]);
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return auth;
}

const settings = async (auth: AuthValue) =>
  (await auth.user?.db.profiles.toCollection().first())?.settings as Record<string, unknown>;

describe('S08 — Aparência (US-58)', () => {
  it('D-025: sem escolha salva, Claro, transparência e movimento automáticos', () => {
    expect(appearanceOf({})).toEqual({ theme: 'light', glass: 'auto', motion: 'auto' });
    expect(appearanceOf({ theme: 'auto', motion: 'full' })).toEqual({
      theme: 'auto',
      glass: 'auto',
      motion: 'auto',
    });
    expect(
      profilePatch({ theme: 'auto', glass: 'solid', motion: 'reduced', values: 'hidden' }),
    ).toEqual({
      theme: 'system',
      glass: 'solid',
      reduceMotion: 'on',
      hideValues: true,
    });
  });

  it('US-58 "Tema": fixar Escuro grava no aparelho e na conta; Automático segue o sistema', async () => {
    const auth = await mount();
    expect(screen.getByRole('radio', { name: 'Claro' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Escuro' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(JSON.parse(localStorage.getItem(ENV_STORAGE_KEY) ?? '{}')).toMatchObject({
      theme: 'dark',
    });
    await waitFor(async () => expect(await settings(auth)).toMatchObject({ theme: 'dark' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Automático', checked: false }));
    await waitFor(async () => expect(await settings(auth)).toMatchObject({ theme: 'system' }));
    expect((await settings(auth)).spendable).toEqual({ savingsMode: 'target' });
  });

  it('US-58 "Reduzir movimento": Reduzido marca data-motion; a opção "Transparência" não aparece mais (D-084)', async () => {
    const auth = await mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Reduzido' }));
    expect(document.documentElement).toHaveAttribute('data-motion', 'reduced');
    await waitFor(async () => expect(await settings(auth)).toMatchObject({ reduceMotion: 'on' }));
    // T-125 (D-084 item 7): sem a escolha de transparência na S08
    expect(screen.queryByRole('radio', { name: 'Sempre sólida' })).toBeNull();
    expect(screen.queryByText('Transparência')).toBeNull();
  });

  it('"Abrir com valores ocultos" vale para a conta', async () => {
    const auth = await mount();
    fireEvent.click(screen.getByRole('switch', { name: 'Abrir com valores ocultos' }));
    expect(document.documentElement).toHaveAttribute('data-values', 'hidden');
    await waitFor(async () => expect(await settings(auth)).toMatchObject({ hideValues: true }));
  });
});
