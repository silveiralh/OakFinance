// T-118 (D-076): navegação no celular — menu da conta no topo das abas, Voltar nas subtelas, abas internas do
// Planejar, menu do toque longo e atalho de importar no vazio de Lançamentos (UXA-001, UXC-002, UXB-002, UXA-012).
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { accountMenuItems, initialsOf } from '../src/app/AccountMenu';
import { App } from '../src/app/App';
import type { AuthValue } from '../src/app/auth';
import { appRoutes } from '../src/app/routes';
import {
  backTarget,
  PLAN_TABS,
  planTabPath,
  previousMonth,
  SHELL_SCREENS,
  TAB_ROOTS,
} from '../src/app/screens';
import { ensureSeeds } from '../src/data/seeds';
import { type ScreenId, shellText } from '../src/i18n/pt-BR';
import { fakeAuth } from './auth-fixture';

async function seeded(): Promise<AuthValue> {
  const auth = fakeAuth();
  if (auth.user) {
    await ensureSeeds(auth.user.db, auth.user.userId);
  }
  return auth;
}

function renderAt(path: string, auth: AuthValue) {
  const router = createMemoryRouter(appRoutes(), { initialEntries: [path] });
  render(<App router={router} auth={auth} />);
  return router;
}

const screenOf = (path: string) =>
  SHELL_SCREENS.find((s) => s.path === path)?.handle.screen as ScreenId;

describe('D-076: regras da navegação', () => {
  it('UXA-012: toda subtela da moldura tem destino de Voltar; as raízes das abas não têm', () => {
    for (const route of SHELL_SCREENS) {
      const id = route.handle.screen as ScreenId;
      if (TAB_ROOTS.has(id)) {
        expect(backTarget(id), id).toBeNull();
      } else {
        expect(backTarget(id), id).toMatch(/^\//);
      }
    }
    expect(backTarget('S06')).toBe('/ajustes');
    expect(backTarget('S01')).toBe('/');
    expect(backTarget('T02')).toBe('/lancamentos');
    expect(backTarget('C02')).toBe('/cartoes');
    expect(backTarget('I03')).toBe('/ajustes/conexoes');
  });

  it('UXB-002: abas internas do Planejar e "Fechar o mês" no mês anterior', () => {
    expect(PLAN_TABS).toEqual(['P01', 'P02', 'P03', 'P04']);
    expect(previousMonth('2026-11-12')).toBe('2026-10');
    expect(previousMonth('2027-01-05')).toBe('2026-12');
    expect(planTabPath('P01', '2026-11-12')).toBe('/planejar/orcamento');
    expect(planTabPath('P02', '2026-11-12')).toBe('/planejar/reserva');
    expect(planTabPath('P03', '2026-11-12')).toBe('/planejar/futuro');
    expect(planTabPath('P04', '2026-11-12')).toBe('/planejar/fechar/2026-10');
    expect(screenOf('/planejar/fechar/:mes')).toBe('P04');
  });

  it('UXA-001/UXC-002: menu da conta com Configurações, Importar extrato e Ler nota fiscal; Conexões só com o Open Finance', () => {
    expect(accountMenuItems(false).map((i) => [i.label, i.href])).toEqual([
      ['Configurações', '/ajustes'],
      ['Importar extrato', '/importar'],
      ['Ler nota fiscal', '/nota'],
    ]);
    expect(accountMenuItems(true).map((i) => i.key)).toEqual([
      'settings',
      'connections',
      'import',
      'note',
    ]);
  });

  it('D-076: iniciais do avatar', () => {
    expect(initialsOf('Maria da Silva')).toBe('MS');
    expect(initialsOf('joão')).toBe('J');
    expect(initialsOf('  ')).toBeNull();
    expect(initialsOf(null)).toBeNull();
  });

  it('UXC-021: a TopBar da S06 usa o título curto; o nome inteiro continua no <title>', () => {
    expect(shellText.shortTitles.S06).toBe('Cálculo e orçamento');
    expect(shellText.screens.S06).toBe('Disponível para gastar e orçamento');
  });
});

describe('US-58: navegação no celular pela moldura', () => {
  it('UXA-001: no Início o avatar abre o menu da conta e Configurações leva à S01, que tem Voltar', async () => {
    const router = renderAt('/', await seeded());
    expect(await screen.findByTestId('screen-H01')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu da conta' }));
    const menu = await screen.findByTestId('account-menu');
    for (const label of ['Configurações', 'Importar extrato', 'Ler nota fiscal', 'Sair']) {
      expect(within(menu).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(menu).queryByRole('button', { name: 'Conexões e importação' })).toBeNull();
    fireEvent.click(within(menu).getByRole('button', { name: 'Configurações' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes'));
    expect(await screen.findByTestId('screen-S01')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir menu da conta' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('UXA-012: subtela aberta direto volta para a tela-mãe', async () => {
    const router = renderAt('/ajustes/contas', await seeded());
    expect(await screen.findByTestId('screen-S03')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes'));
  });

  it('UXC-002: o menu da conta leva a Importar extrato pelo celular', async () => {
    const router = renderAt('/lancamentos', await seeded());
    expect(await screen.findByTestId('screen-T01')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu da conta' }));
    fireEvent.click(
      within(await screen.findByTestId('account-menu')).getByRole('button', {
        name: 'Importar extrato',
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/importar'));
  });

  it('UXB-002: o Planejar tem as abas Orçamento · Reserva · Futuro · Fechar o mês', async () => {
    const router = renderAt('/planejar/orcamento', await seeded());
    const tabs = await screen.findByTestId('plan-tabs');
    for (const label of ['Orçamento', 'Reserva', 'Futuro', 'Fechar o mês']) {
      expect(within(tabs).getByRole('radio', { name: label })).toBeInTheDocument();
    }
    expect(within(tabs).getByRole('radio', { name: 'Orçamento' })).toBeChecked();
    fireEvent.click(within(tabs).getByRole('radio', { name: 'Reserva' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/planejar/reserva'));
    fireEvent.click(
      within(await screen.findByTestId('plan-tabs')).getByRole('radio', { name: 'Fechar o mês' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/planejar\/fechar\/\d{4}-\d{2}$/),
    );
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
  });

  it('D-076: Lançamentos vazio oferece "Importar extrato"', async () => {
    const router = renderAt('/lancamentos', await seeded());
    fireEvent.click(await screen.findByRole('button', { name: 'Importar extrato' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/importar'));
  });

  it('UXC-021: a TopBar da S06 mostra "Cálculo e orçamento"', async () => {
    renderAt('/ajustes/calculo', await seeded());
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Cálculo e orçamento',
    );
    await act(async () => {});
  });
});
