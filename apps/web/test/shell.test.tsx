import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, type RouteObject } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { quickEntryHref, SIDEBAR_ITEMS, TAB_ITEMS } from '../src/app/AppShell';
import { errorCode } from '../src/app/errorCode';
import { appRoutes } from '../src/app/routes';
import { ScreenErrorView } from '../src/app/ScreenError';
import { SPLASH_PROGRESS_DELAY_MS, Splash } from '../src/app/Splash';
import {
  installScreen,
  ONBOARDING_SCREENS,
  PUBLIC_SCREENS,
  resolveScreen,
  SHELL_SCREENS,
} from '../src/app/screens';
import { documentTitle, type ScreenId, shellText } from '../src/i18n/pt-BR';
import { fakeAuth } from './auth-fixture';

const here = dirname(fileURLToPath(import.meta.url));
const ux = readFileSync(join(here, '../../../docs/specs/03-ux-design-system.md'), 'utf8');
const shellCss = readFileSync(join(here, '../src/app/shell.css'), 'utf8');

/** Cabeçalhos `### ID — Nome · \`/rota\` · …` da UX §3, com o nome sem o trecho entre parênteses. */
function uxScreens(): Map<string, { title: string; path: string }> {
  const out = new Map<string, { title: string; path: string }>();
  for (const match of ux.matchAll(/^### ([A-Z]+\d+[a-z]?) — (.+)$/gm)) {
    const [id = '', rest = ''] = [match[1], match[2]];
    const parts = rest.split(' · ');
    const title = (parts[0] ?? '').replace(/\s*\([^)]*\)$/, '');
    const path = /`([^`]+)`/.exec(rest)?.[1] ?? '';
    out.set(id, { title, path });
  }
  return out;
}

/** Caminho da UX com os parâmetros do código (`:aaaa-mm` → `:mes`, query fora). */
function routerPath(uxPath: string): string {
  return uxPath.replace(':aaaa-mm', ':mes').replace(/\?.*$/, '');
}

function renderAt(path: string, routes: RouteObject[] = appRoutes(), auth = fakeAuth()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<App router={router} auth={auth} />);
  return router;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('rotas do UX §2.1 e §3', () => {
  const spec = uxScreens();

  it('cada tela com rota na UX §3 está na tabela, com o mesmo caminho e o mesmo nome', () => {
    const table = new Map<string, string>();
    for (const route of [...SHELL_SCREENS, ...PUBLIC_SCREENS, ...ONBOARDING_SCREENS]) {
      if (typeof route.handle.screen === 'string' && route.path !== '/auth/callback') {
        table.set(route.handle.screen, route.path);
      }
    }
    table.set('ON02a', '/instalar');
    table.set('ON02b', '/instalar');
    table.set('ON02c', '/instalar');
    const withRoute = [...spec].filter(([, { path }]) => path.startsWith('/'));
    expect(withRoute.length).toBeGreaterThanOrEqual(26);
    for (const [id, { title, path }] of withRoute) {
      expect(table.get(id), id).toBe(routerPath(path));
      expect(shellText.screens[id as ScreenId], id).toBe(title);
    }
    expect(Object.keys(shellText.screens).sort()).toEqual(withRoute.map(([id]) => id).sort());
  });

  it('UX §4.11.1: título "{Tela} · OakFinance"', () => {
    expect(documentTitle('H01')).toBe('Início · OakFinance');
    expect(documentTitle('C02')).toBe('Fatura do mês · OakFinance');
  });

  it('ON02a/b/c pelo parâmetro p', () => {
    expect(installScreen(new URLSearchParams('p=android'))).toBe('ON02a');
    expect(installScreen(new URLSearchParams('p=ios'))).toBe('ON02b');
    expect(installScreen(new URLSearchParams('p=desktop'))).toBe('ON02c');
    expect(installScreen(new URLSearchParams(''))).toBe('ON02c');
    expect(resolveScreen({ screen: 'T01' }, new URLSearchParams())).toBe('T01');
  });

  it('todas as telas carregam sob demanda (lazy) um componente', async () => {
    for (const route of [...SHELL_SCREENS, ...PUBLIC_SCREENS, ...ONBOARDING_SCREENS]) {
      expect(typeof (await route.load()), route.path).toBe('function');
    }
  });

  it.each([
    ['/', 'H01', 'home'],
    ['/avisos', 'H02', 'home'],
    ['/lancamentos', 'T01', 'transactions'],
    ['/lancamentos/abc', 'T02', 'transactions'],
    ['/cartoes', 'C01', 'cards'],
    ['/cartoes/c1/fatura/2026-11', 'C02', 'cards'],
    ['/planejar/orcamento', 'P01', 'plan'],
    ['/planejar/reserva', 'P02', 'plan'],
    ['/planejar/futuro', 'P03', 'plan'],
    ['/planejar/fechar/2026-10', 'P04', 'plan'],
    ['/ajustes', 'S01', 'settings'],
    ['/ajustes/conexoes', 'I01', 'connections'],
    ['/ajustes/conexoes/novo', 'I02', 'connections'],
    ['/importar', 'I03', 'connections'],
    ['/nota', 'I04', 'connections'],
    ['/conferir', 'I05', 'transactions'],
  ] as const)(
    '%s abre %s no AppShell, com título e item de navegação ativo',
    async (path, id, nav) => {
      renderAt(path);
      expect(await screen.findByTestId(`screen-${id}`)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(shellText.screens[id]);
      await waitFor(() => expect(document.title).toBe(documentTitle(id)));
      const current = document.querySelector(`.shell-side-link[aria-current="page"]`);
      expect(current?.getAttribute('data-nav')).toBe(nav);
    },
  );

  it.each([
    ['/boas-vindas', 'ON01'],
    ['/instalar?p=ios', 'ON02b'],
    ['/instalar?p=android', 'ON02a'],
    ['/entrar', 'ON03'],
    ['/boas-vindas/lembretes', 'ON04'],
    ['/boas-vindas/renda', 'ON05'],
    ['/boas-vindas/contas', 'ON06'],
    ['/boas-vindas/cartoes', 'ON07'],
    ['/boas-vindas/reserva', 'ON07b'],
    ['/boas-vindas/pronto', 'ON08'],
  ] as const)('%s abre %s no onboarding, sem abas', async (path, id) => {
    const isPublic = ['ON01', 'ON02a', 'ON02b', 'ON03'].includes(id);
    renderAt(path, appRoutes(), fakeAuth(isPublic ? 'signedOut' : 'signedIn'));
    expect(await screen.findByTestId(`screen-${id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'conteudo');
    await waitFor(() => expect(document.title).toBe(documentTitle(id)));
  });

  it('/planejar abre a aba Orçamento e caminho desconhecido volta ao Início', async () => {
    const router = renderAt('/planejar');
    expect(await screen.findByTestId('screen-P01')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/planejar/orcamento');
    await act(() => router.navigate('/nao-existe'));
    expect(await screen.findByTestId('screen-H01')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('a rota de erro do E2E não existe fora do build E2E', async () => {
    const router = renderAt('/__erro');
    expect(await screen.findByTestId('screen-H01')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('AppShell (UX §3.0 e §2.1)', () => {
  it('landmarks: header, navegação principal e main#conteudo; "Pular para o conteúdo" é o primeiro foco', async () => {
    renderAt('/lancamentos');
    await screen.findByTestId('screen-T01');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'conteudo');
    expect(screen.getAllByRole('navigation', { name: 'Navegação principal' })).toHaveLength(2);
    const first = screen.getByTestId('app-shell').querySelector('a, button');
    expect(first).toHaveTextContent('Pular para o conteúdo');
    expect(first).toHaveAttribute('href', '#conteudo');
  });

  it('abas na ordem da UX §2.1 com o FAB no meio; barra lateral com Configurações e Conexões', async () => {
    renderAt('/');
    await screen.findByTestId('screen-H01');
    expect(TAB_ITEMS.map((item) => [item.label, item.href])).toEqual([
      ['Início', '/'],
      ['Lançamentos', '/lancamentos'],
      ['Cartões', '/cartoes'],
      ['Planejar', '/planejar/orcamento'],
    ]);
    expect(SIDEBAR_ITEMS.slice(4).map((item) => item.label)).toEqual(['Configurações', 'Conexões']);
    const tabbar = document.querySelector('.shell-tabbar');
    const children = [...(tabbar?.children ?? [])].map((el) =>
      el.classList.contains('tab-center') ? '+' : el.textContent,
    );
    expect(children).toEqual(['Início', 'Lançamentos', '+', 'Cartões', 'Planejar']);
    expect(tabbar?.querySelector('[aria-current="page"]')).toHaveTextContent('Início');
  });

  it('a aba navega pelo roteador e marca aria-current', async () => {
    const router = renderAt('/');
    await screen.findByTestId('screen-H01');
    const tabbar = document.querySelector('.shell-tabbar') as HTMLElement;
    const cards = [...tabbar.querySelectorAll('a')].find((a) => a.textContent === 'Cartões');
    fireEvent.click(cards as HTMLAnchorElement);
    expect(await screen.findByTestId('screen-C01')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/cartoes');
    await waitFor(() =>
      expect(tabbar.querySelector('[aria-current="page"]')).toHaveTextContent('Cartões'),
    );
  });

  it('FAB e o botão da barra lateral abrem o Q01 como sheet (?novo=despesa) sobre a tela atual', async () => {
    const router = renderAt('/cartoes?mes=2026-11');
    await screen.findByTestId('screen-C01');
    fireEvent.click(screen.getAllByRole('button', { name: 'Novo lançamento' })[0] as HTMLElement);
    await waitFor(() => expect(router.state.location.search).toBe('?mes=2026-11&novo=despesa'));
    expect(router.state.location.pathname).toBe('/cartoes');
    expect(quickEntryHref('/', '')).toBe('/?novo=despesa');
    expect(quickEntryHref('/', '?novo=receita')).toBe('/?novo=despesa');
  });

  it('CSS: abas fixas no celular e barra lateral de 248 px no lg, só com tokens', () => {
    expect(shellCss).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*\.shell \.shell-tabbar \{\s*display: none;/,
    );
    expect(shellCss).toMatch(/\.shell \.shell-tabbar \{[^}]*position: fixed;/);
    expect(shellCss).toMatch(/\.shell \.shell-sidebar \{\s*position: fixed;/);
    expect(shellCss).toMatch(/width: 248px/);
    expect(shellCss).toMatch(/max-width: 1200px/);
    expect(shellCss).toMatch(/calc\(64px \+ env\(safe-area-inset-bottom\) \+ var\(--space-6\)\)/);
    expect(shellCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});

function Boom(): never {
  throw new Error('falha de teste');
}

describe('G09: erro de tela (US-64)', () => {
  function routesWithBoom(): RouteObject[] {
    const routes = appRoutes();
    const shell = routes[0]?.children?.[0]?.children?.[0]; // raiz → RequireSession → AppShell
    shell?.children?.[0]?.children?.push({
      path: '/quebra',
      handle: { screen: 'T01' },
      Component: Boom,
    });
    return routes;
  }

  it('US-64: erro inesperado na tela mostra a mensagem, "Tentar novamente" e um código curto; a moldura fica', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderAt('/quebra', routesWithBoom());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Não foi possível carregar esta tela.');
    expect(alert).toHaveTextContent('Seus dados estão seguros.');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByTestId('screen-error')).toHaveTextContent(/E-[0-9A-Z]{6}/);
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lançamentos');
  });

  it('o texto do G09 é o da UX §3 G e §6.6', () => {
    const g09 = /\| G09 \|[^\n]*\| "([^"]+)" \*\*/.exec(ux)?.[1];
    expect(`${shellText.screenErrorTitle} ${shellText.screenErrorDescription}`).toBe(g09);
    expect(ux).toContain(`| Tela não carregou | ${g09} | **${shellText.retry}** |`);
  });

  it('"Tentar novamente" chama a nova tentativa', () => {
    const retry = vi.fn();
    render(<ScreenErrorView error={new Error('x')} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('código: estável por tipo e mensagem, R-<status> para resposta de rota, sem a mensagem', () => {
    const a = errorCode(new Error('quebrou'));
    expect(a).toMatch(/^E-[0-9A-Z]{6}$/);
    expect(errorCode(new Error('quebrou'))).toBe(a);
    expect(errorCode(new TypeError('quebrou'))).not.toBe(a);
    expect(errorCode({ status: 404 })).toBe('R-404');
    expect(errorCode('texto solto')).toMatch(/^E-[0-9A-Z]{6}$/);
    expect(a).not.toContain('quebrou');
  });
});

describe('S00 Abertura (UX §3.0)', () => {
  it('wordmark sem barra; a barra indeterminada só aparece depois de 400 ms', () => {
    vi.useFakeTimers();
    render(<Splash />);
    expect(screen.getByRole('img', { name: 'OakFinance' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SPLASH_PROGRESS_DELAY_MS - 1);
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('progressbar', { name: 'Carregando' })).toBeInTheDocument();
  });
});
