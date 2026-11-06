// T-058: painel "Disponível para gastar" (H01, H01-S) — US-30, RN-44, RN-46..RN-51, E02 e E17 no nível de componente.
import { invoiceForPurchase } from '@oakfinance/domain';
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
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { cardFromRow } from '../src/data/mappers';
import { saveRow } from '../src/data/repositories/rows';
import { relativeDay } from '../src/features/dashboard/HomeCards';
import { HomeOverview, useToday } from '../src/features/dashboard/HomeOverview';
import {
  dayPeriod,
  firstName,
  type HomeRows,
  homeModel,
  msUntilNextDay,
} from '../src/features/dashboard/model';
import { buildInvoice } from '../src/features/quick-entry/model';
import { filtersFromParams, NO_FILTERS } from '../src/features/transactions/list';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-15';
const USER = '00000000-0000-7000-8000-000000000001';
const STAMP = '2026-11-01T12:00:00.000Z';

function category(
  id: string,
  kind: 'income' | 'expense',
  bucket: 'needs' | 'wants' | 'savings' | 'income',
): LocalRow<'categories'> {
  return makeRow('categories', {
    id,
    slug: id,
    name: id,
    kind,
    bucket,
    parent_id: null,
    deleted_at: null,
    archived_at: null,
    is_system: false,
    feeds_reserve: bucket === 'savings',
  });
}

const CATEGORIES = [
  category('salario', 'income', 'income'),
  category('renda-extra', 'income', 'income'),
  category('reserva-emergencia', 'expense', 'savings'),
  category('mercado', 'expense', 'needs'),
  category('moradia', 'expense', 'needs'),
  category('contas-da-casa', 'expense', 'needs'),
];

const ACCOUNT = makeRow('accounts', {
  id: 'bb',
  name: 'Conta BB',
  type: 'checking',
  is_restricted: false,
  include_in_spendable: true,
  initial_balance_cents: 0,
  initial_balance_on: '2026-01-01',
  deleted_at: null,
  archived_at: null,
});

const CARD = makeRow('cards', {
  id: 'a',
  name: 'Cartão A',
  closing_day: 3,
  due_day: 10,
  closing_day_rule: 'next',
  limit_cents: null,
  payment_account_id: 'bb',
  deleted_at: null,
  archived_at: null,
});

function invoiceOf(purchase: string): LocalRow<'invoices'> {
  const period = invoiceForPurchase(cardFromRow(CARD), purchase as never);
  return { ...buildInvoice(period, USER, STAMP), is_manual_dates: false };
}

const NOV = invoiceOf('2026-10-20');
const DEC = invoiceOf('2026-11-15');

function recurrence(id: string, over: Partial<LocalRow<'recurrences'>>): LocalRow<'recurrences'> {
  return makeRow('recurrences', {
    id,
    kind: 'expense',
    description: id,
    amount_cents: 1000,
    is_variable_amount: false,
    is_fixed_income: false,
    category_id: 'contas-da-casa',
    account_id: 'bb',
    card_id: null,
    payment_method: 'pix',
    frequency: 'monthly',
    interval_count: 1,
    day_of_month: 20,
    weekday: null,
    month_of_year: null,
    start_on: '2026-01-01',
    end_on: null,
    max_occurrences: null,
    paused_at: null,
    deleted_at: null,
    auto_post: false,
    remind: true,
    ...over,
  });
}

const RECURRENCES = [
  recurrence('rec-salario', {
    kind: 'income',
    description: 'Salário',
    is_fixed_income: true,
    category_id: 'salario',
    amount_cents: 500000,
    day_of_month: 5,
  }),
  recurrence('rec-luz', { description: 'Luz', is_variable_amount: true, amount_cents: 18000 }),
  recurrence('rec-internet', { description: 'Internet', amount_cents: 10000, day_of_month: 25 }),
];

const base = {
  account_id: 'bb',
  card_id: null,
  invoice_id: null,
  deleted_at: null,
  series_id: null,
  recurrence_id: null,
  recurrence_date: null,
  goal_id: null,
  income_expected: false,
  count_before_received: false,
} as const;

/** Caso de referência da RN-47 (modo caixa, hoje 15/11/2026, Cartão A F=3/V=10). */
function referenceTxs(): LocalRow<'transactions'>[] {
  return [
    tx('salario-nov', {
      ...base,
      kind: 'income',
      category_id: 'salario',
      amount_cents: 500000,
      occurred_on: '2026-11-05',
      recurrence_id: 'rec-salario',
      recurrence_date: '2026-11-05',
      source: 'recurrence',
    }),
    tx('freela-10', {
      ...base,
      kind: 'income',
      category_id: 'renda-extra',
      amount_cents: 80000,
      occurred_on: '2026-11-10',
    }),
    tx('freela-25', {
      ...base,
      kind: 'income',
      category_id: 'renda-extra',
      amount_cents: 30000,
      occurred_on: '2026-11-25',
      income_expected: true,
    }),
    tx('reserva', {
      ...base,
      category_id: 'reserva-emergencia',
      amount_cents: 20000,
      occurred_on: '2026-11-06',
    }),
    tx('mercado', {
      ...base,
      category_id: 'mercado',
      amount_cents: 45000,
      occurred_on: '2026-11-08',
      payment_method: 'debit',
    }),
    tx('aluguel', {
      ...base,
      category_id: 'moradia',
      amount_cents: 150000,
      occurred_on: '2026-11-10',
    }),
    tx('compra-out', {
      ...base,
      account_id: null,
      card_id: 'a',
      invoice_id: NOV.id,
      payment_method: 'credit',
      category_id: 'mercado',
      amount_cents: 120000,
      occurred_on: '2026-10-20',
    }),
    tx('pagamento-nov', {
      ...base,
      kind: 'transfer',
      category_id: null,
      counterpart_card_id: 'a',
      invoice_id: NOV.id,
      amount_cents: 120000,
      occurred_on: '2026-11-10',
      payment_method: 'transfer',
    }),
  ];
}

function rows(txRows: LocalRow<'transactions'>[], over: Partial<HomeRows> = {}): HomeRows {
  return {
    txRows,
    recurrences: RECURRENCES,
    cards: [CARD],
    accounts: [ACCOUNT],
    categories: CATEGORIES,
    invoices: [NOV, DEC],
    budgets: [],
    profile: null,
    ...over,
  };
}

async function seed(auth: AuthValue, data: HomeRows) {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  await db.categories.bulkPut([...data.categories]);
  await db.accounts.bulkPut([...data.accounts]);
  await db.cards.bulkPut([...data.cards]);
  await db.invoices.bulkPut([...data.invoices]);
  await db.recurrences.bulkPut([...data.recurrences]);
  await db.transactions.bulkPut([...data.txRows]);
}

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

describe('H01 — Disponível para gastar (US-30)', () => {
  it('US-30: caso de referência — R$ 1.210,00, R$ 75,62 por dia até 30/11 e "No ritmo do mês"', async () => {
    await renderHome(rows(referenceTxs()));
    expect(screen.getByText('Disponível para gastar em novembro')).toBeInTheDocument();
    expect(hero()).toHaveTextContent('R$ 1.210,00');
    expect(screen.getByTestId('home-per-day')).toHaveTextContent('R$ 75,62 por dia até 30/11');
    expect(screen.getByTestId('home-pace')).toHaveTextContent('No ritmo do mês');
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-status', 'on_track');
    expect(
      screen.getByRole('heading', { name: 'Disponível para gastar: R$ 1.210,00' }),
    ).toBeInTheDocument();
  });

  it('RN-49: H01-S — receitas R$ 5.800,00 (fixa + variável), já gasto R$ 3.350,00, ainda vai sair R$ 280,00, poupança R$ 960,00', async () => {
    const { router } = await renderHome(rows(referenceTxs()));
    fireEvent.click(screen.getByTestId('home-how'));
    const sheet = await screen.findByTestId('home-formula');
    const line = (key: string) => sheet.querySelector(`[data-line="${key}"] a`) as HTMLElement;
    expect(line('fixed')).toHaveTextContent('Receita fixa do mês');
    expect(line('fixed')).toHaveTextContent('+ R$ 5.000,00');
    expect(line('variable')).toHaveTextContent('+ R$ 800,00');
    expect(line('expected')).toHaveTextContent('+ R$ 0,00');
    expect(sheet.querySelector('[data-line="withdrawals"]')).toBeNull();
    expect(line('spent')).toHaveTextContent('Gastos realizados');
    expect(line('spent')).toHaveTextContent('− R$ 3.350,00');
    expect(line('upcoming')).toHaveTextContent('− R$ 280,00');
    expect(line('savings')).toHaveTextContent('Poupança do mês (20%)');
    expect(line('savings')).toHaveTextContent('− R$ 960,00');
    expect(screen.getByTestId('home-formula-total')).toHaveTextContent('R$ 1.210,00');
    expect(sheet).toHaveTextContent(
      'Você pode ajustar o cálculo em Ajustes › Disponível para gastar.',
    );
    // "ainda vencem" mostra as próximas saídas por data
    const next = within(sheet.querySelector('.home-formula-next') as HTMLElement);
    expect(next.getByText('20/11 · Luz')).toBeInTheDocument();
    expect(next.getByText('25/11 · Internet')).toBeInTheDocument();
    // cada linha abre a T01 filtrada
    fireEvent.click(line('spent'));
    await waitFor(() => expect(router.state.location.search).toBe('?filtro=expense'));
  });

  it('US-30: compra no cartão A em 15/11 (fatura dez) não muda o valor e soma R$ 150,00 em "No cartão para os próximos meses"', async () => {
    const { auth } = await renderHome(rows(referenceTxs()));
    expect(screen.getByTestId('home-future-card')).toHaveTextContent(
      'No cartão para os próximos meses: R$ 0,00',
    );
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
    await waitFor(() =>
      expect(screen.getByTestId('home-future-card')).toHaveTextContent(
        'No cartão para os próximos meses: R$ 150,00',
      ),
    );
    expect(hero()).toHaveTextContent('R$ 1.210,00');
  });

  it('US-30/E02: R$ 50,00 no débito em 15/11 → R$ 1.160,00 na hora, sem rede (RN-51)', async () => {
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
    await waitFor(() => expect(hero()).toHaveTextContent('R$ 1.160,00'));
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

  it('RN-48: mês sem renda — sem o valor, com "Cadastrar renda", "Lançar receita" e "Você já gastou R$ X este mês"', async () => {
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
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-status', 'no_income');
    expect(screen.getByTestId('home-hero')).not.toHaveAttribute('data-available');
    expect(screen.getByText('Cadastre sua renda para ver quanto pode gastar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cadastrar renda' })).toHaveAttribute(
      'href',
      '/ajustes/renda',
    );
    expect(screen.getByRole('link', { name: 'Lançar receita' })).toBeInTheDocument();
    expect(hero()).toHaveTextContent('Você já gastou R$ 45,90 este mês');
    expect(screen.queryByTestId('home-per-day')).toBeNull();
    expect(screen.queryByTestId('home-pace')).toBeNull();
  });

  it('RN-48/RN-50: negativo — "−R$ 120,00", "Acima do planejado em R$ 120,00", "Ver onde ajustar" e sem valor por dia', async () => {
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
    expect(hero()).toHaveTextContent('−R$ 120,00');
    expect(screen.getByTestId('home-pace')).toHaveTextContent('Acima do planejado em R$ 120,00');
    expect(screen.getByRole('link', { name: /Ver onde ajustar/ })).toHaveAttribute(
      'href',
      '/planejar/orcamento',
    );
    expect(screen.queryByTestId('home-per-day')).toBeNull();
  });

  it('RN-48/RN-50: zero — "R$ 0,00" e "No limite do planejado" (attention), sem valor por dia', async () => {
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
            amount_cents: 80000,
            occurred_on: '2026-11-03',
          }),
        ],
        { recurrences: [] },
      ),
    );
    expect(hero()).toHaveTextContent('R$ 0,00');
    expect(screen.getByTestId('home-hero')).toHaveAttribute('data-status', 'attention');
    expect(screen.getByTestId('home-pace')).toHaveTextContent('No limite do planejado');
    expect(screen.queryByTestId('home-per-day')).toBeNull();
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
    await screen.findByText('Disponível para gastar em novembro');
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
    expect(await screen.findByText('Disponível para gastar em dezembro')).toBeInTheDocument();
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

  it('RN-44: card 50/30/20 com as metas sobre a Base de R$ 5.800,00', async () => {
    await renderHome(rows(referenceTxs()));
    const card = screen.getByTestId('home-budget');
    expect(card).toHaveTextContent('Necessidades');
    expect(card).toHaveTextContent('de R$ 2.900,00');
    expect(card).toHaveTextContent('de R$ 1.740,00');
    expect(card).toHaveTextContent('R$ 200,00 de R$ 1.160,00');
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
