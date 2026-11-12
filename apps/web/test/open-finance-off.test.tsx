// T-115 (D-080): Open Finance fora do MVP. Com `OPEN_FINANCE_ENABLED = false` (o padrão de produção), nenhum
// caminho visível leva a conectar banco: a I02 volta para a I01, a I01 só importa extrato e lê nota, o Início não
// avisa conexão, a S07 não lista o lembrete de conexão e a exclusão da conta não fala do Meu Pluggy.
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { AuthContext, type AuthValue } from '../src/app/auth';
import { OPEN_FINANCE_ENABLED } from '../src/app/openFinance';
import { appRoutes } from '../src/app/routes';
import type { LocalRow, OakDb } from '../src/data/db';
import { ensureSeeds } from '../src/data/seeds';
import { DeleteAccountCard } from '../src/features/settings/DeleteAccountCard';
import { DiagnosticsScreen } from '../src/features/settings/DiagnosticsScreen';
import { ReminderPrefs } from '../src/features/settings/ReminderPrefs';
import { PREF_GROUPS, visiblePrefGroups } from '../src/features/settings/reminder-prefs';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

vi.mock('../src/app/openFinance', () => ({ OPEN_FINANCE_ENABLED: false }));

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

/** Conexão que, com o Open Finance ligado, mostraria o card na I01 e o aviso "precisa ser renovada" no Início. */
function expiredConnection(userId: string): LocalRow<'bank_connections'> {
  const iso = new Date().toISOString();
  return {
    id: 'conn-1',
    user_id: userId,
    provider: 'pluggy',
    external_item_id: 'item-1',
    connector_id: 1,
    connector_name: 'MeuPluggy',
    institution: 'nubank',
    status: 'OUTDATED',
    execution_status: null,
    consent_expires_at: null,
    last_synced_at: iso,
    last_success_at: iso,
    provider_updated_at: null,
    last_error: null,
    is_active: true,
    last_manual_refresh_at: null,
    created_at: iso,
    updated_at: iso,
    client_updated_at: iso,
    deleted_at: null,
    server_version: 1,
    device_id: null,
  } as LocalRow<'bank_connections'>;
}

async function signedIn(): Promise<AuthValue> {
  const auth = fakeAuth();
  const db = dbOf(auth);
  await ensureSeeds(db, auth.user?.userId ?? '');
  await db.bank_connections.put(expiredConnection(auth.user?.userId ?? ''));
  return auth;
}

function openApp(auth: AuthValue, path: string) {
  const router = createMemoryRouter(appRoutes(), { initialEntries: [path] });
  render(<App router={router} auth={auth} />);
  return router;
}

function mount(auth: AuthValue, element: ReactNode) {
  const router = createMemoryRouter([{ path: '*', element }]);
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('T-115: Open Finance fora do MVP (D-080)', () => {
  it('D-080: a constante de build fica desligada fora do build E2E', async () => {
    const real =
      await vi.importActual<typeof import('../src/app/openFinance')>('../src/app/openFinance');
    expect(real.OPEN_FINANCE_ENABLED).toBe(false);
    expect(OPEN_FINANCE_ENABLED).toBe(false);
  });

  it('US-45 (D-080): a I01 mostra só "Importar extrato" e "Nota fiscal (NFC-e)", sem "Conectar banco"', async () => {
    openApp(await signedIn(), '/ajustes/conexoes');
    const screenI01 = await screen.findByTestId('screen-I01');
    expect(await within(screenI01).findByText('Importar extrato')).toBeInTheDocument();
    expect(within(screenI01).getByText('Nota fiscal (NFC-e)')).toBeInTheDocument();
    expect(within(screenI01).getByRole('button', { name: 'Escolher arquivo' })).toBeInTheDocument();
    expect(
      within(screenI01).getByRole('button', { name: 'Ler QR code da nota' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Bancos conectados (Open Finance)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Conectar banco' })).toBeNull();
    expect(screen.queryByText('Nenhum banco conectado')).toBeNull();
    expect(screen.queryByTestId('connections-banks')).toBeNull();
  });

  it('US-45 (D-080): a rota da I02 redireciona para a I01', async () => {
    const router = openApp(await signedIn(), '/ajustes/conexoes/novo');
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes/conexoes'));
    expect(await screen.findByTestId('screen-I01')).toBeInTheDocument();
    expect(screen.queryByTestId('screen-I02')).toBeNull();
  });

  it('RN-94 (D-080): o Início não mostra o aviso de conexão, mesmo com uma conexão expirada no aparelho', async () => {
    openApp(await signedIn(), '/');
    expect(await screen.findByTestId('screen-H01')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByTestId('connection-banner')).toBeNull();
    expect(screen.queryByText('Sua conexão com o Nubank precisa ser renovada')).toBeNull();
  });

  it('US-44 (D-080): a S07 não lista "Conexão bancária"; os outros tipos continuam', async () => {
    mount(await signedIn(), <ReminderPrefs />);
    const card = await screen.findByTestId('reminder-prefs');
    expect(
      await within(card).findByRole('switch', { name: 'Lembrete diário' }),
    ).toBeInTheDocument();
    expect(within(card).queryByRole('switch', { name: 'Conexão bancária' })).toBeNull();
    expect(screen.queryByTestId('pref-bank')).toBeNull();
    expect(visiblePrefGroups(false).map((g) => g.id)).toEqual(
      PREF_GROUPS.map((g) => g.id).filter((id) => id !== 'bank'),
    );
    expect(visiblePrefGroups(true)).toEqual(PREF_GROUPS);
  });

  it('US-61 (D-080): excluir a conta não fala em revogar o acesso no Meu Pluggy', async () => {
    mount(fakeAuth(), <DeleteAccountCard onBackup={() => Promise.resolve()} />);
    expect(screen.getByText('Excluir minha conta e dados')).toBeInTheDocument();
    expect(screen.queryByText(/Meu Pluggy/)).toBeNull();
  });

  it('US-64 (D-080): o Diagnóstico não mostra a seção de conexões bancárias', async () => {
    mount(await signedIn(), <DiagnosticsScreen />);
    expect(await screen.findByTestId('diag-push')).toBeInTheDocument();
    expect(screen.queryByText('Conexões bancárias')).toBeNull();
  });
});
