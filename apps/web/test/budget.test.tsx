// T-059: P01 Orçamento 50/30/20 e limites por categoria — US-31, US-32, RN-41, RN-43..RN-45, RN-92.
import { noticeId } from '@oakfinance/domain';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import { alertToast, BudgetAlerts } from '../src/app/BudgetAlerts';
import type { LocalRow } from '../src/data/db';
import { categoryLimit, monthLimits, setCategoryLimit } from '../src/data/repositories/budgets';
import { saveRow } from '../src/data/repositories/rows';
import { BudgetScreen } from '../src/features/budget/BudgetScreen';
import { budgetAlerts, budgetView, parseBudgetKey } from '../src/features/budget/budget';
import type { HomeRows } from '../src/features/dashboard/model';
import { filtersFromParams, NO_FILTERS } from '../src/features/transactions/list';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-15';

function category(
  id: string,
  name: string,
  kind: 'income' | 'expense',
  bucket: 'needs' | 'wants' | 'savings' | 'income' | 'none',
  over: Partial<LocalRow<'categories'>> = {},
): LocalRow<'categories'> {
  return makeRow('categories', {
    id,
    slug: id,
    name,
    kind,
    bucket,
    parent_id: null,
    deleted_at: null,
    archived_at: null,
    is_system: false,
    feeds_reserve: bucket === 'savings',
    icon: null,
    ...over,
  });
}

const CATEGORIES = [
  category('renda-extra', 'Renda extra', 'income', 'income'),
  category('mercado', 'Mercado', 'expense', 'needs'),
  category('moradia', 'Moradia', 'expense', 'needs'),
  category('restaurantes', 'Restaurantes e delivery', 'expense', 'wants'),
  category('lazer', 'Lazer', 'expense', 'wants'),
  category('reserva', 'Reserva de emergência', 'expense', 'savings'),
  category('a-classificar', 'A classificar', 'expense', 'none', { is_system: true }),
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

const income = (cents: number) =>
  tx('renda', {
    ...base,
    kind: 'income',
    category_id: 'renda-extra',
    amount_cents: cents,
    occurred_on: '2026-11-05',
  });

const spend = (id: string, categoryId: string, cents: number, on = '2026-11-08') =>
  tx(id, { ...base, category_id: categoryId, amount_cents: cents, occurred_on: on });

function limitRow(categoryId: string, cents: number): LocalRow<'budgets'> {
  return makeRow('budgets', {
    id: `lim-${categoryId}`,
    scope: 'category',
    bucket: null,
    category_id: categoryId,
    month: null,
    pct_bp: null,
    limit_cents: cents,
    alert_thresholds_bp: [8000, 10000],
    deleted_at: null,
  });
}

function rows(txRows: LocalRow<'transactions'>[], budgets: LocalRow<'budgets'>[] = []): HomeRows {
  return {
    txRows,
    recurrences: [],
    cards: [],
    accounts: [],
    categories: CATEGORIES,
    invoices: [],
    budgets,
    profile: null,
  };
}

async function seed(auth: AuthValue, data: HomeRows) {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  await db.categories.bulkPut([...data.categories]);
  await db.transactions.bulkPut([...data.txRows]);
  await db.budgets.bulkPut([...data.budgets]);
}

async function renderBudget(data: HomeRows) {
  const auth = fakeAuth();
  await seed(auth, data);
  const router = createMemoryRouter([{ path: '*', element: <BudgetScreen today={TODAY} /> }]);
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  // T-124 (UXB-015): sem renda não há cards de faixa; a tela pronta tem a faixa ou o vazio
  await screen.findByTestId(/^(budget-needs|budget-no-income)$/);
  return auth;
}

describe('P01 — Orçamento 50/30/20 (US-31)', () => {
  it('US-31: Base R$ 5.800,00 → metas R$ 2.900,00, R$ 1.740,00 e R$ 1.160,00, com "já foi" e "vai sair" em texto', async () => {
    await renderBudget(
      rows([
        income(580000),
        spend('mercado-1', 'mercado', 45000),
        spend('mercado-2', 'mercado', 15000, '2026-11-28'),
        spend('lazer', 'lazer', 20000),
      ]),
    );
    expect(screen.getByTestId('budget-income')).toHaveTextContent('R$ 5.800,00');
    // T-124 (UXB-015): a renda aparece uma vez só, no centro do anel, com o rótulo
    expect(screen.getAllByText('R$ 5.800,00')).toHaveLength(1);
    expect(screen.getByTestId('budget-income').previousElementSibling).toHaveTextContent(
      'Renda do mês',
    );
    const needs = screen.getByTestId('budget-needs');
    expect(needs).toHaveTextContent('Necessidades');
    expect(needs).toHaveTextContent('R$ 600,00 de R$ 2.900,00 · 20%');
    expect(needs).toHaveTextContent('Já foi R$ 450,00 · Vai sair R$ 150,00');
    expect(needs).toHaveTextContent('Dentro do planejado');
    expect(screen.getByTestId('budget-wants')).toHaveTextContent('R$ 200,00 de R$ 1.740,00 · 11%');
    expect(screen.getByTestId('budget-savings')).toHaveTextContent(
      'Poupado R$ 0,00 de R$ 1.160,00',
    );
    expect(within(needs).getByRole('progressbar', { name: 'Necessidades' })).toHaveAttribute(
      'aria-valuenow',
      '20',
    );
  });

  it('US-31: tocar na faixa mostra as categorias com barras por categoria', async () => {
    await renderBudget(rows([income(580000), spend('mercado-1', 'mercado', 45000)]));
    const head = within(screen.getByTestId('budget-needs')).getByRole('button', {
      name: /Necessidades/,
    });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    const row = screen.getByTestId('budget-category-mercado');
    expect(row).toHaveTextContent('Mercado');
    expect(row).toHaveTextContent('Já foi R$ 450,00 · Vai sair R$ 0,00');
    expect(screen.queryByTestId('budget-category-moradia')).toBeNull();
  });

  it('US-31: faixa ≥ 80% avisa "Restam … até o limite" e acima de 100% "… acima do planejado"', async () => {
    await renderBudget(
      rows([income(100000), spend('m', 'mercado', 42000), spend('l', 'lazer', 32000)]),
    );
    expect(screen.getByTestId('budget-needs')).toHaveTextContent('Restam R$ 80,00 até o limite');
    expect(screen.getByTestId('budget-wants')).toHaveTextContent('R$ 20,00 acima do planejado');
  });

  it('RN-41: Sem faixa — "3 lançamentos para classificar" com o atalho para classificá-los', async () => {
    await renderBudget(
      rows([
        income(580000),
        spend('x1', 'a-classificar', 1000),
        spend('x2', 'a-classificar', 2000),
        spend('x3', 'a-classificar', 3000),
      ]),
    );
    const group = screen.getByTestId('budget-unbucketed');
    expect(group).toHaveTextContent('Sem faixa');
    expect(group).toHaveTextContent('3 lançamentos para classificar');
    expect(within(group).getByRole('link', { name: 'Classificar' })).toHaveAttribute(
      'href',
      '/lancamentos?categoria=a-classificar',
    );
  });

  it('US-31: Poupança como mínimo — "Poupado R$ 200,00 de R$ 1.160,00", sem linguagem de estouro', async () => {
    await renderBudget(rows([income(580000), spend('aporte', 'reserva', 20000)]));
    const savings = screen.getByTestId('budget-savings');
    expect(savings).toHaveTextContent('Poupado R$ 200,00 de R$ 1.160,00');
    expect(savings).not.toHaveTextContent(/acima|limite|planejado/);
  });

  it('US-31/RN-44: Base R$ 333,33 e 50% → meta de Necessidades R$ 166,67', async () => {
    await renderBudget(rows([income(33333)]));
    expect(screen.getByTestId('budget-needs')).toHaveTextContent('de R$ 166,67');
  });

  it('RN-48/US-63: sem renda, metas zeradas e "Orçamento sem renda cadastrada" (UX §6.5)', async () => {
    await renderBudget(rows([spend('m', 'mercado', 1000)]));
    expect(screen.getByText('Orçamento sem renda cadastrada')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Cadastre sua renda para dividir o mês entre Necessidades, Desejos e Poupança.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar renda' })).toBeInTheDocument();
    // T-124 (UXB-015): sem renda, as faixas zeradas somem e o vazio é a única chamada; o anel fica sem centro
    expect(screen.queryByTestId('budget-needs')).toBeNull();
    expect(screen.queryByText('Dentro do planejado')).toBeNull();
    expect(screen.queryByTestId('budget-income')).toBeNull();
  });
});

describe('Limite por categoria (US-32, RN-92)', () => {
  it('US-32: limite de R$ 400,00 em "Restaurantes e delivery" mostra "R$ 120,00 de R$ 400,00"', async () => {
    await renderBudget(
      rows([income(580000), spend('r', 'restaurantes', 12000)], [limitRow('restaurantes', 40000)]),
    );
    fireEvent.click(
      within(screen.getByTestId('budget-wants')).getByRole('button', { name: /Desejos/ }),
    );
    const row = screen.getByTestId('budget-category-restaurantes');
    expect(row).toHaveTextContent('R$ 120,00 de R$ 400,00');
    expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
  });

  it('US-32: setCategoryLimit cria o limite padrão, muda o valor e tira com 0', async () => {
    const auth = fakeAuth();
    const db = auth.user?.db;
    if (!db || !auth.user) {
      throw new Error('sem sessão');
    }
    await setCategoryLimit(db, auth.user.userId, 'restaurantes', 40000);
    let all = await db.budgets.toArray();
    expect(categoryLimit(all, 'restaurantes')).toMatchObject({
      scope: 'category',
      category_id: 'restaurantes',
      month: null,
      limit_cents: 40000,
      alert_thresholds_bp: [8000, 10000],
    });
    await setCategoryLimit(db, auth.user.userId, 'restaurantes', 50000);
    all = await db.budgets.toArray();
    expect(all.filter((b) => b.deleted_at === null)).toHaveLength(1);
    expect(monthLimits(all, '2026-11')).toEqual([
      { categoryId: 'restaurantes', limitCents: 50000, alertThresholdsBp: [8000, 10000] },
    ]);
    await setCategoryLimit(db, auth.user.userId, 'restaurantes', 0);
    all = await db.budgets.toArray();
    expect(categoryLimit(all, 'restaurantes')).toBeNull();
    expect(monthLimits(all, '2026-11')).toEqual([]);
  });

  it('RN-92: R$ 300,00 de R$ 400,00 + R$ 25,00 → aviso de 80% com a dedupe_key do servidor', () => {
    const before = budgetAlerts(
      rows([income(580000), spend('r1', 'restaurantes', 30000)], [limitRow('restaurantes', 40000)]),
      TODAY,
      false,
    );
    expect(before).toEqual([]);
    const data = rows(
      [
        income(580000),
        spend('r1', 'restaurantes', 30000),
        spend('r2', 'restaurantes', 2500, TODAY),
      ],
      [limitRow('restaurantes', 40000)],
    );
    const after = budgetAlerts(data, TODAY, false);
    expect(after.map((a) => a.dedupeKey)).toEqual(['budget:restaurantes:2026-11:8000']);
    expect(parseBudgetKey('budget:restaurantes:2026-11:8000')).toEqual({
      ref: 'restaurantes',
      month: '2026-11',
      thresholdBp: 8000,
    });
    expect(alertToast(after[0] as never, budgetView(data, TODAY))).toBe(
      'Restaurantes e delivery atingiu 81% do limite',
    );
  });

  it('RN-92: faixa acima de 100% e sem Base não avisa', () => {
    const over = rows([income(100000), spend('l', 'lazer', 31000)]);
    const alerts = budgetAlerts(over, TODAY, false);
    expect(alerts.map((a) => a.dedupeKey)).toEqual(['budget:wants:2026-11:10000']);
    expect(alertToast(alerts[0] as never, budgetView(over, TODAY))).toBe(
      'Desejos acima do planejado',
    );
    expect(budgetAlerts(rows([spend('l', 'lazer', 31000)]), TODAY, false)).toEqual([]);
  });

  it('US-32/RN-92: o toast aparece uma única vez no mês e o aviso fica na central (notices)', async () => {
    const auth = fakeAuth();
    const db = auth.user?.db;
    if (!db || !auth.user) {
      throw new Error('sem sessão');
    }
    await seed(
      auth,
      rows([income(580000), spend('r1', 'restaurantes', 30000)], [limitRow('restaurantes', 40000)]),
    );
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <BudgetAlerts today={TODAY} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText(/atingiu/)).toBeNull();
    await act(async () => {
      await saveRow(db, 'transactions', spend('r2', 'restaurantes', 2500, TODAY));
    });
    expect(
      await screen.findByText('Restaurantes e delivery atingiu 81% do limite'),
    ).toBeInTheDocument();
    const key = 'budget:restaurantes:2026-11:8000';
    await waitFor(async () =>
      expect(await db.notices.get(noticeId(auth.user?.userId ?? '', key))).toMatchObject({
        kind: 'budget_threshold',
        dedupe_key: key,
        title: 'Restaurantes e delivery atingiu 80% do …', // título de push: até 40 caracteres (UX §6.2)
        navigate: '/planejar/orcamento',
      }),
    );
    // mais um gasto na mesma faixa de alerta: nenhum toast novo
    await act(async () => {
      await saveRow(db, 'transactions', spend('r3', 'restaurantes', 100, TODAY));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(await db.notices.count()).toBe(1);
  });

  it('T01 abre filtrada por categoria (?categoria=)', () => {
    expect(filtersFromParams(new URLSearchParams('categoria=mercado'))).toEqual({
      ...NO_FILTERS,
      categoryId: 'mercado',
    });
  });
});
