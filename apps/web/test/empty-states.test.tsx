// T-067: estados vazios (US-63, RN-48) — a tabela da UX §6.5 é a fonte e cada tela sem dados mostra título, texto e
// ação dela.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import type { AuthValue } from '../src/app/auth';
import { appRoutes } from '../src/app/routes';
import { ensureSeeds } from '../src/data/seeds';
import { NO_FILTERS } from '../src/features/transactions/list';
import { emptyKind } from '../src/features/transactions/TransactionsScreen';
import { emptyStates } from '../src/i18n/pt-BR';
import { fakeAuth } from './auth-fixture';

// Os cenários deste arquivo cobrem o app com o Open Finance ligado (build E2E e v2); sem ele, ver
// test/open-finance-off.test.tsx (T-115, D-080).
vi.mock('../src/app/openFinance', () => ({ OPEN_FINANCE_ENABLED: true }));
// a tabela de rotas lê a mesma constante em linha (screens.ts)
vi.stubEnv('VITE_OPEN_FINANCE', '1');

const here = dirname(fileURLToPath(import.meta.url));
const ux = readFileSync(join(here, '../../../docs/specs/03-ux-design-system.md'), 'utf8');

function uxEmptyRows() {
  const section = ux.slice(ux.indexOf('### 6.5 '), ux.indexOf('### 6.6 '));
  return section
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Tela') && !l.startsWith('|---'))
    .map((l) => {
      const [, title = '', text = '', action = ''] = l
        .replace(/^\|\s*|\s*\|\s*$/g, '')
        .split(' | ')
        .map((c) => c.trim());
      const actions =
        action === '—' ? [] : action.split(' · ').map((a) => a.replace(/\*\*/g, '').trim());
      return { title, text, actions };
    });
}

describe('UX §6.5', () => {
  it('RN-48: os textos dos estados vazios são os da tabela, na mesma ordem', () => {
    expect(Object.values(emptyStates).map((s) => ({ ...s, actions: [...s.actions] }))).toEqual(
      uxEmptyRows(),
    );
  });

  it('T01: busca, filtro ou mês vazio', () => {
    expect(emptyKind(NO_FILTERS)).toBe('listMonth');
    expect(emptyKind({ ...NO_FILTERS, query: '  pão ' })).toBe('search');
    expect(emptyKind({ ...NO_FILTERS, chip: 'expense' })).toBe('listFilter');
    expect(emptyKind({ ...NO_FILTERS, band: 'needs' })).toBe('listFilter');
  });
});

async function auth(seeds: boolean): Promise<AuthValue> {
  const value = fakeAuth();
  if (seeds && value.user) {
    await ensureSeeds(value.user.db, value.user.userId);
  }
  return value;
}

function open(value: AuthValue, path: string) {
  const router = createMemoryRouter(appRoutes(), { initialEntries: [path] });
  render(<App router={router} auth={value} />);
  return router;
}

const examples: ReadonlyArray<{
  tela: string;
  path: string;
  seeds?: boolean;
  setup?: (a: AuthValue) => Promise<void>;
  mensagem: string | RegExp;
  texto?: string;
  acao?: string;
}> = [
  {
    tela: 'Painel sem renda',
    path: '/',
    // D-081: a Saúde do mês pede a renda (o herói mostra o gasto)
    mensagem: 'Cadastre sua renda para acompanhar as faixas do mês.',
    acao: 'Cadastrar renda',
  },
  {
    tela: 'Lista do mês',
    path: '/lancamentos',
    mensagem: /^Nenhum lançamento em /,
    texto: emptyStates.listMonth.text,
    acao: 'Novo lançamento',
  },
  {
    tela: 'Cartões',
    path: '/cartoes',
    mensagem: 'Nenhum cartão cadastrado',
    texto: emptyStates.cards.text,
    acao: 'Adicionar cartão',
  },
  {
    tela: '50/30/20 sem renda',
    path: '/planejar/orcamento',
    seeds: true,
    mensagem: 'Orçamento sem renda cadastrada',
    texto: emptyStates.budgetNoIncome.text,
    acao: 'Cadastrar renda',
  },
  {
    tela: 'Reserva sem meta',
    path: '/planejar/reserva',
    seeds: true,
    mensagem: 'Defina uma meta para acompanhar o progresso',
    texto: emptyStates.reserveNoGoal.text,
    acao: 'Definir meta',
  },
  {
    tela: 'Regras',
    path: '/ajustes/regras',
    mensagem: 'Nenhuma regra criada',
    texto: emptyStates.rules.text,
  },
  {
    tela: 'Central de avisos',
    path: '/avisos',
    mensagem: 'Nenhum aviso',
    texto: emptyStates.notices.text,
  },
  {
    tela: 'Conferir importados',
    path: '/conferir',
    mensagem: 'Nenhum lançamento pendente',
    texto: emptyStates.inbox.text,
  },
  {
    tela: 'Conexões bancárias',
    path: '/ajustes/conexoes',
    mensagem: 'Nenhum banco conectado',
    texto: emptyStates.connections.text,
    acao: 'Conectar banco',
  },
  {
    tela: 'Futuro',
    path: '/planejar/futuro',
    mensagem: 'Nenhum valor comprometido',
    texto: emptyStates.future.text,
  },
];

// "Fatura sem itens" (Nenhuma compra nesta fatura) está em test/invoices.test.tsx, com o cartão e a fatura montados.
describe('US-63: estado vazio', () => {
  it.each(examples)(
    'US-63: $tela mostra "$mensagem"',
    async ({ path, seeds, setup, mensagem, texto, acao }) => {
      const value = await auth(seeds === true);
      await setup?.(value);
      open(value, path);
      const title = await screen.findByText(mensagem, undefined, { timeout: 4000 });
      expect(title).toBeInTheDocument();
      if (texto) {
        expect(screen.getByText(texto)).toBeInTheDocument();
      }
      if (acao) {
        const found = [
          ...screen.queryAllByRole('button', { name: acao }),
          ...screen.queryAllByRole('link', { name: acao }),
        ];
        expect(found.length).toBeGreaterThan(0);
      }
    },
  );

  it('US-63: busca sem resultado mostra "Nenhum resultado para "<termo>""', async () => {
    open(await auth(false), '/lancamentos');
    await screen.findByText(/^Nenhum lançamento em /);
    fireEvent.change(screen.getByLabelText('Buscar lançamentos'), { target: { value: 'padaria' } });
    expect(await screen.findByText('Nenhum resultado para "padaria"')).toBeInTheDocument();
    expect(screen.getByText(emptyStates.search.text)).toBeInTheDocument();
  });

  it('UX §6.5: filtro sem lançamento oferece "Limpar filtros", que volta ao mês', async () => {
    open(await auth(false), '/lancamentos?filtro=expense');
    const empty = await screen.findByText('Nenhum lançamento com este filtro');
    expect(empty).toBeInTheDocument();
    const section = empty.closest('section') ?? document.body;
    fireEvent.click(within(section as HTMLElement).getByRole('button', { name: 'Limpar filtros' }));
    expect(await screen.findByText(/^Nenhum lançamento em /)).toBeInTheDocument();
  });

  it('UX §6.5 (UXD-001): conexões oferecem também "Importar extrato", no card logo abaixo do vazio', async () => {
    const router = open(await auth(false), '/ajustes/conexoes');
    expect(await screen.findByText('Importar extrato')).toBeInTheDocument();
    fireEvent.change(await screen.findByTestId('connections-import-file'), {
      target: { files: [new File(['OFXHEADER:100'], 'extrato.ofx')] },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/importar'));
  });
});
