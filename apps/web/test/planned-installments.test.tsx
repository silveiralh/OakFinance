// T-116 (UXB-001): parcelas futuras de uma compra no cartão aparecem como "Prevista" (RN-23, D-034), em ordem na
// série, e não somam no dia da compra nem no resumo do mês da compra.
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import {
  filterTransactions,
  groupByDay,
  isPlannedInstallment,
  monthSummary,
  NO_FILTERS,
  plannedIds,
} from '../src/features/transactions/list';
import { TransactionDetailScreen } from '../src/features/transactions/TransactionDetailScreen';
import { TransactionsScreen, toRow } from '../src/features/transactions/TransactionsScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-11';
type Row = LocalRow<'transactions'>;

/** Fatura de cada parcela: nov/2026 (aberta, fecha 20/11), dez/2026 (futura) e out/2026 (já fechada). */
const INVOICES = [
  {
    id: 'f-out',
    reference_month: '2026-10-01',
    closing_date: '2026-10-20',
    due_date: '2026-10-28',
  },
  {
    id: 'f-nov',
    reference_month: '2026-11-01',
    closing_date: '2026-11-20',
    due_date: '2026-11-28',
  },
  {
    id: 'f-dez',
    reference_month: '2026-12-01',
    closing_date: '2026-12-20',
    due_date: '2026-12-28',
  },
  {
    id: 'f-jan',
    reference_month: '2027-01-01',
    closing_date: '2027-01-20',
    due_date: '2027-01-28',
  },
].map((i) =>
  makeRow('invoices', { ...i, card_id: 'nu', deleted_at: null }),
) as LocalRow<'invoices'>[];

const CLOSING = new Map(INVOICES.map((i) => [i.id, i.closing_date]));

function parcel(n: number, invoiceId: string, created: string): Row {
  return tx(`p${n}`, {
    description: 'Notebook',
    amount_cents: 60000,
    payment_method: 'credit',
    card_id: 'nu',
    account_id: null,
    invoice_id: invoiceId,
    series_id: 'serie-1',
    installment_number: n,
    installment_count: 3,
    occurred_on: TODAY,
    created_at: created,
    deleted_at: null,
  });
}

// criadas na mesma gravação, em ordem embaralhada de created_at (como na auditoria)
const SERIES = [
  parcel(1, 'f-nov', '2026-11-11T12:00:00.002Z'),
  parcel(3, 'f-jan', '2026-11-11T12:00:00.003Z'),
  parcel(2, 'f-dez', '2026-11-11T12:00:00.001Z'),
];
const PADARIA = tx('pad', {
  description: 'Padaria',
  amount_cents: 1500,
  occurred_on: TODAY,
  created_at: '2026-11-11T09:00:00.000Z',
  deleted_at: null,
});

describe('RN-23: parcela prevista derivada da fatura (UXB-001)', () => {
  it('RN-23: parcela 1 é efetivada; parcela k > 1 é prevista enquanto a fatura não fecha', () => {
    expect(isPlannedInstallment(parcel(1, 'f-nov', ''), '2026-11-20', TODAY)).toBe(false);
    expect(isPlannedInstallment(parcel(2, 'f-dez', ''), '2026-12-20', TODAY)).toBe(true);
    // fatura aberta (fecha depois de hoje) e no próprio dia do fechamento: ainda prevista
    expect(isPlannedInstallment(parcel(2, 'f-nov', ''), '2026-11-20', TODAY)).toBe(true);
    expect(isPlannedInstallment(parcel(2, 'f-nov', ''), TODAY, TODAY)).toBe(true);
    // fatura fechada: passa a efetivada
    expect(isPlannedInstallment(parcel(2, 'f-out', ''), '2026-10-20', TODAY)).toBe(false);
    // sem a fatura no aparelho, sem cartão ou cancelada: não deriva
    expect(isPlannedInstallment(parcel(2, 'f-dez', ''), undefined, TODAY)).toBe(false);
    expect(
      isPlannedInstallment({ ...parcel(2, 'f-dez', ''), card_id: null }, '2026-12-20', TODAY),
    ).toBe(false);
    expect(
      isPlannedInstallment({ ...parcel(2, 'f-dez', ''), status: 'cancelled' }, '2026-12-20', TODAY),
    ).toBe(false);
  });

  it('RN-23: na T01 a parcela futura tem o selo "Prevista" e a primeira não tem selo', () => {
    const planned = plannedIds([...SERIES, PADARIA], CLOSING, TODAY);
    expect([...planned].sort()).toEqual(['p2', 'p3']);
    expect(toRow(SERIES[2] as Row, undefined, TODAY, planned.has('p2')).state).toBe('forecast');
    expect(toRow(SERIES[0] as Row, undefined, TODAY, planned.has('p1')).state).toBeUndefined();
  });

  it('RN-23: as previstas não somam no dia da compra nem no resumo do mês; a série sai em ordem', () => {
    const rows = [...SERIES, PADARIA];
    const planned = plannedIds(rows, CLOSING, TODAY);
    const [day] = groupByDay(rows, planned);
    expect(day?.outCents).toBe(60000 + 1500);
    expect(day?.rows.map((r) => r.id)).toEqual(['p1', 'p2', 'p3', 'pad']);
    expect(monthSummary(rows, new Map(), planned).outCents).toBe(60000 + 1500);
  });

  it('RN-23: o chip "Previstas" e o status "Prevista" encontram as parcelas futuras; "Efetivada" não', () => {
    const rows = [...SERIES, PADARIA];
    const planned = plannedIds(rows, CLOSING, TODAY);
    const ids = (f: typeof NO_FILTERS) =>
      filterTransactions(rows, f, new Map(), TODAY, planned)
        .map((r) => r.id)
        .sort();
    expect(ids({ ...NO_FILTERS, chip: 'forecast' })).toEqual(['p2', 'p3']);
    expect(ids({ ...NO_FILTERS, status: 'forecast' })).toEqual(['p2', 'p3']);
    expect(ids({ ...NO_FILTERS, status: 'posted' })).toEqual(['p1', 'pad']);
  });
});

async function seeded(): Promise<AuthValue> {
  const auth = fakeAuth('signedIn');
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem usuário');
  }
  await db.cards.put(makeRow('cards', { id: 'nu', name: 'Nubank', deleted_at: null }));
  await db.invoices.bulkPut(INVOICES);
  await db.transactions.bulkPut([...SERIES, PADARIA]);
  return auth;
}

function mount(auth: AuthValue, path: string, element: ReactNode, pattern = '*') {
  const router = createMemoryRouter([{ path: pattern, element }], { initialEntries: [path] });
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('US-24: telas com a parcela prevista', () => {
  it('US-24: a T01 mostra "Prevista" nas parcelas futuras e o dia soma só o que já foi gasto', async () => {
    mount(await seeded(), '/lancamentos', <TransactionsScreen today={TODAY} />);
    const p2 = await screen.findByTestId('tx-p2');
    expect(within(p2).getByText('Prevista')).toBeInTheDocument();
    expect(within(screen.getByTestId('tx-p1')).queryByText('Prevista')).toBeNull();
    // −R$ 615,00 = parcela 1 (R$ 600,00) + padaria (R$ 15,00); sem as parcelas 2 e 3
    expect(screen.getByTestId('list-day')).toHaveTextContent('615,00');
    expect(screen.getByTestId('list-day')).not.toHaveTextContent('1.815,00');
    expect(screen.getByTestId('list-summary')).toHaveTextContent('615,00');
  });

  it('US-24: a T02 da parcela 2/3 (fatura de dezembro) mostra "Prevista", não "Efetivada"', async () => {
    const auth = await seeded();
    mount(
      { ...auth, client: null },
      '/lancamentos/p2',
      <TransactionDetailScreen today={TODAY} />,
      '/lancamentos/:id',
    );
    expect((await screen.findAllByText(/Prevista/)).length).toBeGreaterThan(0);
    expect(screen.queryByText('Efetivada')).toBeNull();
  });
});
