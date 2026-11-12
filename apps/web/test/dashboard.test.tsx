// T-058/T-120: Início (H01) — gasto do mês, saldo nas contas e Saúde do mês (D-081); US-30, RN-44, RN-46..RN-51, E02
// e E17 no nível de componente. A fórmula do "Disponível para gastar" continua testada no domínio (spendable.ts).
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { saveRow } from '../src/data/repositories/rows';
import { relativeDay } from '../src/features/dashboard/HomeCards';
import { HomeOverview } from '../src/features/dashboard/HomeOverview';
import {
  dayPeriod,
  firstName,
  type HomeRows,
  homeModel,
  msUntilNextDay,
} from '../src/features/dashboard/model';
import { filtersFromParams, NO_FILTERS } from '../src/features/transactions/list';
import { useToday } from '../src/lib/useToday';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { base, DEC, RECURRENCES, referenceTxs, rows, seed, TODAY } from './data/reference';
import { tx } from './data/rows';

async function renderHome(data: HomeRows, today = TODAY) {
  const auth = fakeAuth();
  await seed(auth, data);
  const router = createMemoryRouter(
    [
      { path: '/', element: <HomeOverview today={today} /> },
      { path: '*', element: <p data-testid="elsewhere">fora</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  await screen.findByTestId('home-hero-money');
  return { auth, router };
}

const hero = () => screen.getByTestId('home-hero-money');

afterEach(() => {
  vi.useRealTimers();
});

describe('H01 — gasto do mês e saldo nas contas (US-30, D-081)', () => {
  it('US-30 (D-081): caso de referência — "Gasto em novembro" R$ 3.350,00, ainda vai sair R$ 280,00 e saldo nas contas R$ 2.450,00', async () => {
    await renderHome(rows(referenceTxs()));
    expect(screen.getByText('Gasto em novembro')).toBeInTheDocument();
    expect(hero()).toHaveTextContent('R$ 3.350,00');
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-spent', '335000');
    expect(screen.getByTestId('home-upcoming-month')).toHaveTextContent(
      'Ainda vai sair este mês: R$ 280,00',
    );
    expect(screen.getByTestId('home-balance')).toHaveTextContent('Saldo nas contas');
    expect(screen.getByTestId('home-balance')).toHaveTextContent('R$ 2.450,00');
    expect(
      screen.getByRole('heading', { name: 'Gasto em novembro: R$ 3.350,00' }),
    ).toBeInTheDocument();
    // D-081: o "Disponível para gastar" e o selo da RN-50 saíram do Início
    expect(screen.queryByText(/Disponível para gastar/)).toBeNull();
    expect(screen.queryByTestId('home-pace')).toBeNull();
    expect(screen.queryByTestId('home-per-day')).toBeNull();
  });
  it('RN-49 (D-081): sem a folha H01-S — as previstas ficam fora do herói e o saldo abre a lista de contas', async () => {
    const { router } = await renderHome(rows(referenceTxs()));
    expect(screen.queryByTestId('home-how')).toBeNull();
    expect(screen.queryByTestId('home-formula')).toBeNull();
    // a conta de luz (R$ 280,00, prevista para 20/11) não entra no gasto, só no "ainda vai sair"
    expect(hero()).toHaveTextContent('R$ 3.350,00');
    expect(hero()).not.toHaveTextContent('R$ 3.630,00');
    fireEvent.click(screen.getByTestId('home-balance'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/ajustes/contas'));
  });
  it('US-30 (D-081): compra no cartão A em 15/11 (fatura dez) não muda o gasto de novembro nem o saldo nas contas', async () => {
    const { auth } = await renderHome(rows(referenceTxs()));
    await act(async () => {
      await saveRow(
        auth.user?.db as never,
        'transactions',
        tx('cartao-15', {
          ...base,
          account_id: null,
          card_id: 'a',
          invoice_id: DEC.id,
          payment_method: 'credit',
          category_id: 'mercado',
          amount_cents: 15000,
          occurred_on: TODAY,
        }),
      );
    });
    // o mês de impacto da compra é dezembro (vencimento da fatura, RN-46)
    await waitFor(() =>
      expect(screen.getByTestId('home-balance')).toHaveAttribute('data-balance', '245000'),
    );
    expect(hero()).toHaveTextContent('R$ 3.350,00');
  });
  it('US-30/E02 (D-081): R$ 50,00 no débito em 15/11 → gasto R$ 3.400,00 e saldo R$ 2.400,00 na hora, sem rede (RN-51)', async () => {
    const { auth } = await renderHome(rows(referenceTxs()));
    await act(async () => {
      await saveRow(
        auth.user?.db as never,
        'transactions',
        tx('debito-15', {
          ...base,
          category_id: 'mercado',
          amount_cents: 5000,
          occurred_on: TODAY,
          payment_method: 'debit',
        }),
      );
    });
    await waitFor(() => expect(hero()).toHaveTextContent('R$ 3.400,00'));
    expect(screen.getByTestId('home-balance')).toHaveTextContent('R$ 2.400,00');
  });
  it('RN-51 (issue #136): com o histórico inteiro lido, despesas de anos anteriores não mudam os R$ 3.350,00 gastos no mês', async () => {
    const old = ['2023-11-15', '2024-03-02', '2025-11-30'].map((occurred_on, i) =>
      tx(`antigo-${i}`, {
        ...base,
        category_id: 'mercado',
        amount_cents: 45000,
        occurred_on,
        payment_method: 'pix',
      }),
    );
    const { auth } = await renderHome(rows([...referenceTxs(), ...old]));
    expect(hero()).toHaveTextContent('R$ 3.350,00');
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-spent', '335000');
    // a leitura do Início segue ao vivo: um gasto de hoje entra na hora
    await act(async () => {
      await saveRow(
        auth.user?.db as never,
        'transactions',
        tx('hoje-pix', {
          ...base,
          category_id: 'mercado',
          amount_cents: 1000,
          occurred_on: TODAY,
          payment_method: 'pix',
        }),
      );
    });
    await waitFor(() => expect(hero()).toHaveTextContent('R$ 3.360,00'));
  });

  it('US-30: "Contar antes de receber" no freela de R$ 300,00 → Base R$ 6.100,00 e o valor sobe R$ 240,00', async () => {
    const txs = referenceTxs().map((r) =>
      r.id === 'freela-25' ? { ...r, count_before_received: true } : r,
    );
    const model = homeModel(rows(txs), TODAY);
    expect(model.spendable.income.totalCents).toBe(610000);
    expect(model.spendable.savingsReserveCents).toBe(102000);
    expect(model.spendable.availableCents).toBe(121000 + 24000);
  });

  it('RN-48 (D-081): mês sem renda — o herói mostra o gasto e a Saúde do mês pede a renda com "Cadastrar renda"', async () => {
    await renderHome(
      rows(
        [
          tx('gasto', {
            ...base,
            category_id: 'mercado',
            amount_cents: 4590,
            occurred_on: '2026-11-03',
          }),
        ],
        { recurrences: [] },
      ),
    );
    expect(hero()).toHaveTextContent('R$ 45,90');
    const health = screen.getByTestId('home-health');
    expect(within(health).getByTestId('home-health-no-income')).toHaveTextContent(
      'Cadastre sua renda para acompanhar as faixas do mês.',
    );
    expect(within(health).getByRole('link', { name: 'Cadastrar renda' })).toHaveAttribute(
      'href',
      '/ajustes/renda',
    );
    expect(screen.queryByTestId('home-health-needs')).toBeNull();
  });
  it('RN-44 (D-081): Necessidades acima da meta → "Passou do planejado" com ícone, e o atalho "Ajustar percentuais"', async () => {
    await renderHome(
      rows(
        [
          tx('renda', {
            ...base,
            kind: 'income',
            category_id: 'renda-extra',
            amount_cents: 100000,
            occurred_on: '2026-11-02',
          }),
          tx('gasto', {
            ...base,
            category_id: 'mercado',
            amount_cents: 92000,
            occurred_on: '2026-11-03',
          }),
        ],
        { recurrences: [] },
      ),
    );
    expect(hero()).toHaveTextContent('R$ 920,00');
    const needs = screen.getByTestId('home-health-needs');
    expect(needs).toHaveAttribute('data-health', 'over');
    expect(needs).toHaveTextContent('Passou do planejado');
    expect(needs.querySelector('.home-health-state svg')).not.toBeNull();
    expect(screen.getByTestId('home-health-wants')).toHaveTextContent('No caminho');
    expect(
      within(screen.getByTestId('home-health')).getAllByRole('link', {
        name: /Ajustar percentuais/,
      })[0],
    ).toHaveAttribute('href', '/planejar/orcamento');
  });
  it('RN-44 (D-081): Necessidades entre 80% e 100% da meta → "Atenção" (limiar fixo até a T-121)', async () => {
    await renderHome(
      rows(
        [
          tx('renda', {
            ...base,
            kind: 'income',
            category_id: 'renda-extra',
            amount_cents: 100000,
            occurred_on: '2026-11-02',
          }),
          tx('gasto', {
            ...base,
            category_id: 'mercado',
            amount_cents: 45000,
            occurred_on: '2026-11-03',
          }),
        ],
        { recurrences: [] },
      ),
    );
    const needs = screen.getByTestId('home-health-needs');
    expect(needs).toHaveAttribute('data-health', 'attention');
    expect(needs).toHaveTextContent('Atenção');
    expect(needs).toHaveTextContent('R$ 450,00 de R$ 500,00');
  });
  it('RN-50: atenção abaixo de 20% da Base — "Atenção: restam R$ 100,00"', () => {
    const model = homeModel(
      rows(
        [
          tx('renda', {
            ...base,
            kind: 'income',
            category_id: 'renda-extra',
            amount_cents: 100000,
            occurred_on: '2026-11-02',
          }),
          tx('gasto', {
            ...base,
            category_id: 'mercado',
            amount_cents: 70000,
            occurred_on: '2026-11-03',
          }),
        ],
        { recurrences: [] },
      ),
      TODAY,
    );
    expect(model.spendable.availableCents).toBe(10000);
    expect(model.spendable.status).toBe('attention');
  });

  it('E17: virada do mês — em 01/12 calcula dezembro sem carregar sobra ou déficit de novembro (RN-48)', () => {
    const nov = homeModel(rows(referenceTxs()), '2026-11-30');
    const dec = homeModel(rows(referenceTxs()), '2026-12-01');
    expect(nov.month).toBe('2026-11');
    expect(dec.month).toBe('2026-12');
    // dezembro: só o salário projetado (R$ 5.000,00) e a fatura dez do cartão; nada de novembro entra
    expect(dec.spendable.income.totalCents).toBe(500000);
    expect(dec.spendable.spentCents).toBe(0);
    expect(dec.spendable.daysLeft).toBe(31);
  });

  it('E17: o Início troca de novembro para dezembro sem recarregar quando a data muda', async () => {
    const auth = fakeAuth();
    await seed(auth, rows(referenceTxs()));
    const router = createMemoryRouter([
      { path: '/', element: <HomeOverview today="2026-11-30" /> },
    ]);
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    await screen.findByText('Gasto em novembro');
    const dec = createMemoryRouter([{ path: '/', element: <HomeOverview today="2026-12-01" /> }]);
    await act(async () => {
      router.dispose();
    });
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={dec} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    expect(await screen.findByText('Gasto em dezembro')).toBeInTheDocument();
  });

  it('E17: useToday vira de 31/10 23:59 para 01/11 00:00 no fuso America/Sao_Paulo', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-01T02:59:00.000Z')); // 31/10 23:59 em São Paulo (UTC−3)
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe('2026-10-31');
    act(() => {
      vi.advanceTimersByTime(60_000 + 100);
    });
    expect(result.current).toBe('2026-11-01');
  });

  it('RN-48: msUntilNextDay mede até a meia-noite de São Paulo', () => {
    expect(msUntilNextDay(new Date('2026-11-01T02:59:00.000Z'))).toBe(60_000);
    expect(msUntilNextDay(new Date('2026-11-01T03:00:00.000Z'))).toBe(86_400_000);
  });

  it('RN-51: recálculo com 5.000 lançamentos em menos de 200 ms', () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      tx(`m${i}`, {
        ...base,
        category_id: i % 2 ? 'mercado' : 'moradia',
        amount_cents: 100 + (i % 50),
        occurred_on: `2026-${String((i % 11) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      }),
    );
    const data = rows([...referenceTxs(), ...many]);
    homeModel(data, TODAY); // aquece
    const start = performance.now();
    homeModel(data, TODAY);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('H01 — cards e saudação', () => {
  it('Próximos 7 dias: luz em 20/11 ("Em 5 dias") e a fatura dez em aberto não entra antes do vencimento', () => {
    const model = homeModel(rows(referenceTxs()), TODAY);
    expect(model.upcoming.map((u) => [u.label, u.date])).toEqual([['Luz', '2026-11-20']]);
    expect(relativeDay('2026-11-20', TODAY)).toBe('Em 5 dias');
    expect(relativeDay('2026-11-16', TODAY)).toBe('Amanhã');
    expect(relativeDay(TODAY, TODAY)).toBe('Hoje');
  });

  it('Próximos 7 dias: fatura com saldo em aberto aparece pelo vencimento com o nome do cartão', () => {
    const txs = referenceTxs().filter((r) => r.id !== 'pagamento-nov');
    const model = homeModel(rows(txs), '2026-11-07');
    const invoice = model.upcoming.find((u) => u.kind === 'invoice');
    expect(invoice).toMatchObject({ label: 'Cartão A', date: '2026-11-10', amountCents: 120000 });
    expect(invoice?.href).toBe('/cartoes/a/fatura/2026-11');
  });

  it('RN-44 (D-081): Saúde do mês com uma barra por faixa e as metas sobre a renda de R$ 5.800,00', async () => {
    await renderHome(rows(referenceTxs()));
    const card = screen.getByTestId('home-health');
    expect(card).toHaveTextContent('Saúde do mês');
    expect(screen.getByTestId('home-health-needs')).toHaveTextContent('R$ 3.150,00 de R$ 2.900,00');
    expect(screen.getByTestId('home-health-needs')).toHaveTextContent('Passou do planejado');
    expect(screen.getByTestId('home-health-wants')).toHaveTextContent('R$ 0,00 de R$ 1.740,00');
    expect(screen.getByTestId('home-health-savings')).toHaveTextContent('R$ 200,00 de R$ 1.160,00');
    expect(screen.getByTestId('home-health-savings')).toHaveTextContent('No caminho');
    expect(card.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
  });
  it('saudação pelo período do dia em São Paulo e primeiro nome', () => {
    expect(dayPeriod(new Date('2026-11-15T11:00:00.000Z'))).toBe('morning'); // 08:00
    expect(dayPeriod(new Date('2026-11-15T16:00:00.000Z'))).toBe('afternoon'); // 13:00
    expect(dayPeriod(new Date('2026-11-15T23:30:00.000Z'))).toBe('evening'); // 20:30
    expect(dayPeriod(new Date('2026-11-15T06:00:00.000Z'))).toBe('evening'); // 03:00
    expect(firstName('Pessoa de Teste')).toBe('Pessoa');
    expect(firstName(null)).toBe('');
  });

  it('mês sem lançamentos: "Nenhum lançamento em novembro" com Novo lançamento', async () => {
    await renderHome(rows([], { recurrences: [RECURRENCES[0] as LocalRow<'recurrences'>] }));
    const empty = screen.getByTestId('home-month-empty');
    expect(empty).toHaveTextContent('Nenhum lançamento em novembro');
    expect(empty).toHaveTextContent('Registre um gasto para começar a acompanhar o mês.');
    expect(within(empty).getByRole('button', { name: 'Novo lançamento' })).toBeInTheDocument();
  });

  it('T01 abre filtrada pela URL das linhas do H01-S', () => {
    expect(filtersFromParams(new URLSearchParams('filtro=expense'))).toEqual({
      ...NO_FILTERS,
      chip: 'expense',
    });
    expect(filtersFromParams(new URLSearchParams('faixa=savings'))).toEqual({
      ...NO_FILTERS,
      band: 'savings',
    });
    expect(filtersFromParams(new URLSearchParams('filtro=xyz'))).toBe(NO_FILTERS);
  });
});
