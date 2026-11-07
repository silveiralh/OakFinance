// T-069: análise do mês no computador (US-35; RN-45 "já foi", RN-46 mês orçamentário).
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { analysisMonths, monthAnalysis, referenceDay } from '../src/features/budget/analysis';
import { MonthAnalysis } from '../src/features/budget/MonthAnalysis';
import { fakeAuth } from './auth-fixture';
import { base, CARD, CATEGORIES, category, DEC, rows } from './data/reference';
import { tx } from './data/rows';

const TODAY = '2026-11-15';
const lazer = category('lazer', 'expense', 'wants');
const data = () =>
  rows(
    [
      tx('m1', {
        ...base,
        kind: 'expense',
        amount_cents: 30_000,
        occurred_on: '2026-11-02',
        category_id: 'mercado',
        description: 'Mercado A',
      }),
      tx('m2', {
        ...base,
        kind: 'expense',
        amount_cents: 12_000,
        occurred_on: '2026-11-10',
        category_id: 'mercado',
        description: 'Mercado B',
      }),
      tx('l1', {
        ...base,
        kind: 'expense',
        amount_cents: 50_000,
        occurred_on: '2026-11-05',
        category_id: 'lazer',
        description: 'Show',
      }),
      tx('r1', {
        ...base,
        kind: 'expense',
        amount_cents: 20_000,
        occurred_on: '2026-11-06',
        category_id: 'reserva-emergencia',
        description: 'Reserva',
      }),
      // compra no cartão em 15/11 cai na fatura de dez (RN-46): não conta em novembro
      tx('c1', {
        ...base,
        account_id: null,
        card_id: CARD.id,
        invoice_id: DEC.id,
        payment_method: 'credit',
        kind: 'expense',
        amount_cents: 9_900,
        occurred_on: '2026-11-15',
        category_id: 'lazer',
        description: 'Cartão',
      }),
      // outubro
      tx('o1', {
        ...base,
        kind: 'expense',
        amount_cents: 40_000,
        occurred_on: '2026-10-08',
        category_id: 'mercado',
        description: 'Mercado out',
      }),
      tx('o2', {
        ...base,
        kind: 'expense',
        amount_cents: 7_000,
        occurred_on: '2026-10-09',
        category_id: null,
        description: 'Sem cat',
      }),
    ],
    { categories: [...CATEGORIES, lazer] },
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('monthAnalysis (US-35)', () => {
  it('dia de referência: hoje no mês corrente, último dia no passado', () => {
    expect(referenceDay('2026-11', TODAY)).toBe(TODAY);
    expect(referenceDay('2026-10', TODAY)).toBe('2026-10-31');
    expect(referenceDay('2026-12', TODAY)).toBe('2026-12-01');
    expect(analysisMonths(TODAY).slice(0, 3)).toEqual(['2026-11', '2026-10', '2026-09']);
  });

  it('US-35 "Visão em tela larga": os 5 blocos de novembro', () => {
    const v = monthAnalysis(data(), '2026-11', TODAY);
    expect(v.byCategory.map((c) => [c.name, c.spentCents])).toEqual([
      ['lazer', 50_000],
      ['mercado', 42_000],
      ['reserva-emergencia', 20_000],
    ]);
    expect(v.bands.map((b) => [b.bucket, b.spentCents])).toEqual([
      ['needs', 42_000],
      ['wants', 50_000],
      ['savings', 20_000],
    ]);
    // acumulado sem a Poupança; ritmo ideal = (meta Necessidades + Desejos) × dia / 30
    expect(v.daily).toHaveLength(15);
    expect(v.daily[1]).toMatchObject({ day: 2, actualCents: 30_000 });
    expect(v.daily[14]?.actualCents).toBe(92_000);
    const plan = (v.bands[0]?.targetCents ?? 0) + (v.bands[1]?.targetCents ?? 0);
    expect(v.daily[29 - 15]?.idealCents).toBe(Math.round((plan * 15) / 30));
    expect(v.compare.find((c) => c.id === 'mercado')).toMatchObject({
      currentCents: 42_000,
      previousCents: 40_000,
      diffCents: 2_000,
    });
    expect(v.compare.find((c) => c.id === '')).toMatchObject({
      name: 'Sem categoria',
      diffCents: -7_000,
    });
    expect(v.top.map((e) => e.description)).toEqual(['Show', 'Mercado A', 'Reserva', 'Mercado B']);
  });

  it('US-35 "Trocar de mês": outubro com o mesmo modo de cálculo', () => {
    const v = monthAnalysis(data(), '2026-10', TODAY);
    expect(v.month).toBe('2026-10');
    expect(v.byCategory.map((c) => c.spentCents)).toEqual([40_000, 7_000]);
    expect(v.daily).toHaveLength(31);
    expect(v.top).toHaveLength(2);
    const dec = monthAnalysis(data(), '2026-12', TODAY);
    expect(dec.byCategory).toEqual([{ id: 'lazer', name: 'lazer', spentCents: 9_900 }]);
  });
});

describe('MonthAnalysis na P01 (lg)', () => {
  it('US-35: blocos com "Ver como tabela" e seletor de mês', () => {
    const router = createMemoryRouter([
      { path: '*', element: <MonthAnalysis rows={data()} today={TODAY} /> },
    ]);
    render(
      <AuthContext.Provider value={fakeAuth()}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    for (const id of ['categories', 'bands', 'daily', 'compare', 'top']) {
      expect(screen.getByTestId(`analysis-${id}`)).toBeInTheDocument();
    }
    const top = screen.getByTestId('analysis-top');
    fireEvent.click(within(top).getByRole('button', { name: 'Ver como tabela' }));
    const table = within(top).getByRole('table', { name: '10 maiores gastos' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('Show')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Mês da análise'), { target: { value: '2026-10' } });
    expect(screen.getByTestId('analysis-current')).toHaveTextContent('out/2026');
    expect(within(screen.getByTestId('analysis-top')).getAllByRole('row')).toHaveLength(3);
  });
});
