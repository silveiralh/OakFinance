import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { ensureSeeds } from '../src/data/seeds';
import {
  filteredTotal,
  filterTransactions,
  fold,
  groupByDay,
  monthRange,
  monthSummary,
  monthTitle,
  NO_FILTERS,
  queryAmount,
  visibleWindow,
} from '../src/features/transactions/list';
import { dayLabel, TransactionsScreen } from '../src/features/transactions/TransactionsScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-06';

function cat(id: string, name: string, bucket: string): LocalRow<'categories'> {
  return makeRow('categories', { id, name, bucket, deleted_at: null });
}

const CATS = new Map([
  ['saude', cat('saude', 'Saúde', 'needs')],
  ['lazer', cat('lazer', 'Lazer', 'wants')],
  ['reserva', cat('reserva', 'Reserva', 'savings')],
]);

const ROWS = [
  tx('a', {
    description: 'Farmácia São João',
    amount_cents: 4590,
    category_id: 'saude',
    deleted_at: null,
    occurred_on: '2026-11-04',
  }),
  tx('b', {
    description: 'Cinema',
    amount_cents: 3000,
    category_id: 'lazer',
    payment_method: 'credit',
    card_id: 'nu',
    deleted_at: null,
    occurred_on: '2026-11-06',
  }),
  tx('c', {
    kind: 'income',
    description: 'Salário',
    amount_cents: 500_000,
    deleted_at: null,
    occurred_on: '2026-11-05',
  }),
  tx('d', {
    description: 'Reserva',
    amount_cents: 20_000,
    category_id: 'reserva',
    deleted_at: null,
    occurred_on: '2026-11-05',
  }),
  tx('e', {
    description: 'Conta de luz',
    amount_cents: 15_000,
    status: 'pending',
    deleted_at: null,
    occurred_on: '2026-11-02',
  }),
];

describe('US-15: lista de lançamentos', () => {
  it('US-15: busca "farmacia" encontra "Farmácia São João" (sem acento e sem caixa)', () => {
    expect(fold('Farmácia São João')).toBe('farmacia sao joao');
    const found = filterTransactions(ROWS, { ...NO_FILTERS, query: 'farmacia' }, CATS, TODAY);
    expect(found.map((r) => r.id)).toEqual(['a']);
  });

  it('US-15: busca "45,90" encontra o lançamento de R$ 45,90', () => {
    expect(queryAmount('45,90')).toBe(4590);
    expect(queryAmount('R$ 45,90')).toBe(4590);
    expect(queryAmount('padaria')).toBeNull();
    expect(
      filterTransactions(ROWS, { ...NO_FILTERS, query: '45,90' }, CATS, TODAY).map((r) => r.id),
    ).toEqual(['a']);
  });

  it('US-15: filtros combinam (chip + faixa + status) e mostram o total filtrado', () => {
    const expenses = filterTransactions(ROWS, { ...NO_FILTERS, chip: 'expense' }, CATS, TODAY);
    expect(expenses.map((r) => r.id).sort()).toEqual(['a', 'b', 'd', 'e']);
    const needs = filterTransactions(
      ROWS,
      { ...NO_FILTERS, chip: 'expense', band: 'needs' },
      CATS,
      TODAY,
    );
    expect(needs.map((r) => r.id)).toEqual(['a']);
    expect(filteredTotal(needs)).toBe(-4590);
    const late = filterTransactions(ROWS, { ...NO_FILTERS, status: 'late' }, CATS, TODAY);
    expect(late.map((r) => r.id)).toEqual(['e']);
    expect(
      filterTransactions(ROWS, { ...NO_FILTERS, chip: 'cards' }, CATS, TODAY).map((r) => r.id),
    ).toEqual(['b']);
  });

  it('US-15: grupos por dia do mais recente ao mais antigo, com Hoje e Ontem', () => {
    const groups = groupByDay(ROWS);
    expect(groups.map((g) => g.date)).toEqual([
      '2026-11-06',
      '2026-11-05',
      '2026-11-04',
      '2026-11-02',
    ]);
    expect(groups[1]).toMatchObject({ inCents: 500_000, outCents: 20_000 });
    expect(dayLabel('2026-11-06', TODAY)).toBe('Hoje');
    expect(dayLabel('2026-11-05', TODAY)).toBe('Ontem');
    expect(dayLabel('2026-11-04', TODAY)).toBe('04/11/2026');
  });

  it('US-15: resumo Entradas · Saídas · Guardado e mês', () => {
    expect(monthSummary(ROWS, CATS)).toEqual({
      inCents: 500_000,
      outCents: 4590 + 3000 + 15_000,
      savedCents: 20_000,
    });
    expect(monthTitle('2026-11')).toBe('novembro 2026');
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('US-15: com 5.000 lançamentos a busca leva menos de 300 ms e só as linhas visíveis são desenhadas', () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      tx(`m${i}`, {
        description: i === 4321 ? 'Farmácia Central' : `Compra ${i}`,
        amount_cents: 100 + i,
        deleted_at: null,
        occurred_on: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`,
      }),
    );
    const start = performance.now();
    const found = filterTransactions(many, { ...NO_FILTERS, query: 'farmácia' }, CATS, TODAY);
    groupByDay(many);
    expect(performance.now() - start).toBeLessThan(300);
    expect(found.map((r) => r.id)).toEqual(['m4321']);
    const view = visibleWindow(5028, 72 * 1000, 720, 72);
    expect(view).toEqual({ start: 992, end: 1018 });
  });

  it('US-63: lista vazia e busca sem resultado; excluir mostra "Desfazer"', async () => {
    const auth = fakeAuth('signedIn');
    const user = auth.user;
    if (!user) {
      throw new Error('sem usuário');
    }
    await ensureSeeds(user.db, user.userId);
    await user.db.transactions.put(
      tx('t1', { description: 'Padaria', deleted_at: null, occurred_on: TODAY }),
    );
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <TransactionsScreen today={TODAY} />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: ['/lancamentos'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    expect(await screen.findByTestId('tx-t1')).toBeInTheDocument();
    expect(screen.getByTestId('list-day')).toHaveTextContent('Hoje');
    fireEvent.change(screen.getByLabelText('Buscar lançamentos'), { target: { value: 'xyz' } });
    expect(await screen.findByText('Nenhum resultado para "xyz"')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar lançamentos'), { target: { value: '' } });
    const row = await screen.findByTestId('tx-t1');
    fireEvent.click(within(row).getByRole('button', { name: 'Ações' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await waitFor(async () =>
      expect((await user.db.transactions.get('t1'))?.deleted_at).not.toBeNull(),
    );
    expect(await screen.findByText('Nenhum lançamento em novembro 2026')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await waitFor(async () =>
      expect((await user.db.transactions.get('t1'))?.deleted_at).toBeNull(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(screen.getByTestId('list-month')).toHaveTextContent('outubro 2026');
  });
});
