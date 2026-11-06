// T-060: P02 Reserva de emergência — US-33, US-65, RN-36, RN-52..RN-56.
import { noticeId } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { ReserveScreen } from '../src/features/budget/ReserveScreen';
import { RESERVE_FULL_KEY, reserveView } from '../src/features/budget/reserve';
import { type HomeRows, homeModel } from '../src/features/dashboard/model';
import { QuickEntryHost } from '../src/features/quick-entry/QuickEntryHost';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-15';
const GOAL_ID = 'goal-reserva';

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
    feeds_reserve: id === 'reserva-emergencia',
  });
}

const CATEGORIES = [
  category('renda-extra', 'income', 'income'),
  category('outras-receitas', 'income', 'income'),
  category('mercado', 'expense', 'needs'),
  category('reserva-emergencia', 'expense', 'savings'),
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

function goal(over: Partial<LocalRow<'goals'>> = {}): LocalRow<'goals'> {
  return makeRow('goals', {
    id: GOAL_ID,
    kind: 'emergency_reserve',
    name: 'Reserva de emergência',
    target_mode: 'auto',
    target_cents: null,
    auto_factor: 6,
    auto_lookback_months: 6,
    initial_saved_cents: 0,
    account_id: null,
    achieved_at: null,
    deleted_at: null,
    ...over,
  });
}

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

const income = (cents: number, on = '2026-11-05') =>
  tx(`renda-${on}`, {
    ...base,
    kind: 'income',
    category_id: 'renda-extra',
    amount_cents: cents,
    occurred_on: on,
  });

/** Necessidades do mês em 5 despesas (RN-52 exige pelo menos 5 efetivadas). */
function needsMonth(month: string, totalCents: number): LocalRow<'transactions'>[] {
  const part = Math.floor(totalCents / 5);
  return [0, 1, 2, 3, 4].map((i) =>
    tx(`n-${month}-${i}`, {
      ...base,
      category_id: 'mercado',
      amount_cents: i === 4 ? totalCents - part * 4 : part,
      occurred_on: `${month}-${String(i + 3).padStart(2, '0')}`,
    }),
  );
}

const save = (id: string, cents: number, on = '2026-11-06', goalId: string | null = GOAL_ID) =>
  tx(id, {
    ...base,
    category_id: 'reserva-emergencia',
    amount_cents: cents,
    occurred_on: on,
    goal_id: goalId,
    payment_method: 'transfer',
  });

const withdraw = (id: string, cents: number, on = '2026-11-07') =>
  tx(id, {
    ...base,
    kind: 'income',
    category_id: 'outras-receitas',
    amount_cents: cents,
    occurred_on: on,
    goal_id: GOAL_ID,
  });

function rows(txRows: LocalRow<'transactions'>[]): HomeRows {
  return {
    txRows,
    recurrences: [],
    cards: [],
    accounts: [ACCOUNT],
    categories: CATEGORIES,
    invoices: [],
    budgets: [],
    profile: null,
  };
}

async function renderReserve(data: HomeRows, g: LocalRow<'goals'>) {
  const auth = fakeAuth();
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  await db.categories.bulkPut([...data.categories]);
  await db.accounts.bulkPut([...data.accounts]);
  await db.transactions.bulkPut([...data.txRows]);
  await db.goals.put(g);
  const router = createMemoryRouter([{ path: '*', element: <ReserveScreen today={TODAY} /> }]);
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  await screen.findByTestId('reserve-goal');
  return auth;
}

describe('P02 — Reserva de emergência (US-33)', () => {
  it('US-33/RN-52: Necessidades de ago, set e out = R$ 2.900, R$ 3.100 e R$ 3.000 → meta sugerida R$ 18.000,00', async () => {
    const data = rows([
      ...needsMonth('2026-08', 290000),
      ...needsMonth('2026-09', 310000),
      ...needsMonth('2026-10', 300000),
    ]);
    const view = reserveView(data, goal(), TODAY);
    expect(view.suggestion).toMatchObject({
      targetCents: 1800000,
      avgNeedsCents: 300000,
      provisional: false,
    });
    expect(view.targetCents).toBe(1800000);
    await renderReserve(data, goal());
    expect(screen.getByTestId('reserve-goal')).toHaveTextContent(
      'Meta sugerida: 6× a média mensal de Necessidades (R$ 3.000,00).',
    );
    expect(screen.getByTestId('reserve-saved')).toHaveTextContent(
      'R$ 0,00 guardados de R$ 18.000,00',
    );
  });

  it('US-33/RN-52: sem histórico e Base R$ 5.800,00 → R$ 17.400,00 como estimativa provisória', async () => {
    const data = rows([income(580000)]);
    expect(reserveView(data, goal(), TODAY).suggestion).toMatchObject({
      targetCents: 1740000,
      provisional: true,
    });
    await renderReserve(data, goal());
    expect(screen.getByTestId('reserve-goal')).toHaveTextContent('Estimativa provisória');
    expect(screen.getByTestId('reserve-saved')).toHaveTextContent('de R$ 17.400,00');
  });

  it('RN-52: sem histórico e sem renda não há sugestão e o card pede a renda', async () => {
    await renderReserve(rows([]), goal());
    expect(screen.getByTestId('reserve-goal')).toHaveTextContent(
      'Lance a renda do mês para calcular a meta sugerida.',
    );
    expect(screen.getByTestId('reserve-summary')).toHaveTextContent(
      'Defina uma meta para acompanhar o progresso',
    );
  });

  it('US-33/RN-53: meta manual R$ 10.000,00 não é sobrescrita e mostra "Sugestão atualizada: R$ 18.000,00. Usar?"', async () => {
    const data = rows([
      ...needsMonth('2026-08', 290000),
      ...needsMonth('2026-09', 310000),
      ...needsMonth('2026-10', 300000),
    ]);
    const manual = goal({ target_mode: 'manual', target_cents: 1000000 });
    const view = reserveView(data, manual, TODAY);
    expect(view.targetCents).toBe(1000000);
    expect(view.suggestionChanged).toBe(true);
    const auth = await renderReserve(data, manual);
    expect(screen.getByTestId('reserve-suggestion')).toHaveTextContent(
      'Sugestão atualizada: R$ 18.000,00. Usar?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Usar sugestão' }));
    await waitFor(async () =>
      expect(await auth.user?.db.goals.get(GOAL_ID)).toMatchObject({
        target_mode: 'auto',
        target_cents: null,
      }),
    );
  });

  it('RN-53: sem mudança acima de 10% não mostra a sugestão nova', () => {
    const data = rows([
      ...needsMonth('2026-08', 290000),
      ...needsMonth('2026-09', 310000),
      ...needsMonth('2026-10', 300000),
    ]);
    const view = reserveView(data, goal({ target_mode: 'manual', target_cents: 1700000 }), TODAY);
    expect(view.suggestionChanged).toBe(false);
  });

  it('US-33/RN-56: saldo inicial R$ 2.000 + aportes R$ 200 e R$ 300 − resgate R$ 100 = R$ 2.400,00 e 13% de R$ 18.000,00', async () => {
    const data = rows([save('a1', 20000, '2026-10-06'), save('a2', 30000), withdraw('r1', 10000)]);
    const g = goal({ target_mode: 'manual', target_cents: 1800000, initial_saved_cents: 200000 });
    const view = reserveView(data, g, TODAY);
    expect(view.progress.savedCents).toBe(240000);
    expect(view.percent).toBe(13);
    await renderReserve(data, g);
    expect(screen.getByTestId('reserve-saved')).toHaveTextContent(
      'R$ 2.400,00 guardados de R$ 18.000,00',
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '13');
    expect(screen.getByTestId('reserve-move-a2')).toHaveTextContent('+R$ 300,00');
    expect(screen.getByText('Aportes e retiradas')).toBeInTheDocument();
  });

  it('RN-54: aporte lançado pelo Q01 comum na categoria que alimenta a reserva também conta', () => {
    const data = rows([save('a1', 20000, '2026-11-06', null)]);
    expect(
      reserveView(data, goal({ target_mode: 'manual', target_cents: 100000 }), TODAY).progress
        .savedCents,
    ).toBe(20000);
  });

  it('RN-56: resgates acima do guardado → 0% e "Os resgates passaram do que foi guardado."', async () => {
    const g = goal({ target_mode: 'manual', target_cents: 100000 });
    await renderReserve(rows([withdraw('r1', 10000)]), g);
    expect(screen.getByTestId('reserve-negative')).toHaveTextContent(
      'Os resgates passaram do que foi guardado.',
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('US-33/RN-36: resgate de R$ 500,00 para a conta BB → painel +R$ 500,00, Base igual e reserva −R$ 500,00', async () => {
    const data = rows([income(580000), save('a1', 100000)]);
    const g = goal({ target_mode: 'manual', target_cents: 1000000 });
    const before = homeModel(data, TODAY).spendable;
    const auth = await renderReserve(data, g);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar uso da reserva' }));
    const sheet = await screen.findByTestId('reserve-move');
    const input = within(sheet).getByRole('textbox', { name: 'Valor' });
    for (const d of '50000') {
      fireEvent.keyDown(input, { key: d });
    }
    expect(within(sheet).getByRole('combobox', { name: 'Entra na conta' })).toHaveValue('bb');
    await waitFor(() =>
      expect(within(sheet).getByTestId('reserve-move-submit')).not.toHaveAttribute('aria-disabled'),
    );
    fireEvent.click(within(sheet).getByTestId('reserve-move-submit'));
    expect(
      await screen.findByText('Retirada de R$ 500,00 registrada. A reserva está em 5% da meta.'),
    ).toBeInTheDocument();
    const db = auth.user?.db;
    const all = (await db?.transactions.toArray()) ?? [];
    const out = all.find((r) => r.kind === 'income' && r.goal_id === GOAL_ID);
    expect(out).toMatchObject({ amount_cents: 50000, account_id: 'bb', occurred_on: TODAY });
    const after = homeModel({ ...data, txRows: all }, TODAY).spendable;
    expect(after.income.totalCents).toBe(before.income.totalCents);
    expect(after.availableCents - before.availableCents).toBe(50000);
    expect(reserveView({ ...data, txRows: all }, g, TODAY).progress.savedCents).toBe(50000);
  });

  it('US-65/RN-56: ao alcançar a meta, "Reserva de emergência completa" uma única vez (achieved_at e aviso)', async () => {
    const g = goal({ target_mode: 'manual', target_cents: 100000 });
    const auth = await renderReserve(rows([save('a1', 100000)]), g);
    expect(await screen.findByText('Reserva de emergência completa')).toBeInTheDocument();
    expect(screen.getByTestId('reserve-full')).toHaveTextContent(
      'Meta atingida: R$ 1.000,00 guardados, cerca de 6 meses de Necessidades.',
    );
    const db = auth.user?.db;
    await waitFor(async () => expect((await db?.goals.get(GOAL_ID))?.achieved_at).not.toBeNull());
    const key = RESERVE_FULL_KEY(GOAL_ID);
    const notice = await db?.notices.get(noticeId(auth.user?.userId ?? '', key));
    expect(notice).toMatchObject({ title: 'Reserva de emergência completa', dedupe_key: key });
    expect(await db?.notices.count()).toBe(1);
  });
});

describe('Q01 em modo Guardar (US-33)', () => {
  it('?novo=guardar abre "Guardar na reserva" e grava o aporte com o goal_id e a categoria da reserva', async () => {
    const auth = fakeAuth();
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem sessão');
    }
    await db.categories.bulkPut(CATEGORIES);
    await db.accounts.put(ACCOUNT);
    await db.goals.put(goal({ target_mode: 'manual', target_cents: 1000000 }));
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <QuickEntryHost />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: ['/?novo=guardar'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const sheet = await screen.findByTestId('reserve-move');
    expect(within(sheet).getByRole('heading', { name: 'Guardar na reserva' })).toBeInTheDocument();
    const input = within(sheet).getByRole('textbox', { name: 'Valor' });
    for (const d of '20000') {
      fireEvent.keyDown(input, { key: d });
    }
    await waitFor(() =>
      expect(within(sheet).getByTestId('reserve-move-submit')).not.toHaveAttribute('aria-disabled'),
    );
    fireEvent.click(within(sheet).getByTestId('reserve-move-submit'));
    expect(
      await screen.findByText('R$ 200,00 guardados. A reserva está em 2% da meta.'),
    ).toBeInTheDocument();
    const saved = (await db.transactions.toArray())[0];
    expect(saved).toMatchObject({
      kind: 'expense',
      goal_id: GOAL_ID,
      category_id: 'reserva-emergencia',
      account_id: 'bb',
      card_id: null,
      amount_cents: 20000,
    });
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('?novo=receita abre o Q01 no modo Receita', async () => {
    const auth = fakeAuth();
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <QuickEntryHost />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: ['/?novo=receita'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const sheet = await screen.findByTestId('quick-entry');
    expect(within(sheet).getByRole('radio', { name: 'Receita' })).toBeChecked();
  });
});
