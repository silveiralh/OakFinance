// T-122: Lançamentos (T01/T02) — UXB-003, UXB-005, UXB-006, UXB-009, UXB-022, UXB-024 e D-084 item 1.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { TransactionDetailScreen } from '../src/features/transactions/TransactionDetailScreen';
import { dayLabel, TransactionsScreen } from '../src/features/transactions/TransactionsScreen';
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

describe('T-122: T01', () => {
  it('D-084 (US-15): "Hoje", "Ontem" e "Amanhã"; as outras datas em dd/mm/aaaa', () => {
    expect(dayLabel('2026-11-11', TODAY)).toBe('Hoje');
    expect(dayLabel('2026-11-10', TODAY)).toBe('Ontem');
    expect(dayLabel('2026-11-12', TODAY)).toBe('Amanhã');
    expect(dayLabel('2026-11-13', TODAY)).toBe('13/11/2026');
  });

  it('US-15 (UXB-003): dentro do grupo do dia a linha não repete a data, mas o rótulo lido a mantém', async () => {
    mount(await seeded(), '/lancamentos', <TransactionsScreen today={TODAY} />);
    const row = await screen.findByTestId('tx-pad');
    expect(row.querySelector('.tx-meta')?.textContent ?? '').not.toContain('11/11/2026');
    expect(within(row).getAllByRole('button')[0]?.getAttribute('aria-label')).toContain(
      '11/11/2026',
    );
  });

  it('US-15 (UXB-005): card "{n} para conferir" com o contador do Início leva à conferência', async () => {
    const auth = await seeded();
    await auth.user?.db.transactions.put(
      tx('imp', {
        description: 'PIX RECEBIDO',
        amount_cents: 1000,
        occurred_on: '2026-10-02',
        source: 'ofx',
        review_state: 'new',
        deleted_at: null,
      }),
    );
    const router = createMemoryRouter(
      [
        { path: '/lancamentos', element: <TransactionsScreen today={TODAY} /> },
        { path: '/conferir', element: <p>conferência</p> },
      ],
      { initialEntries: ['/lancamentos'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    const card = await screen.findByTestId('list-review');
    expect(card).toHaveTextContent('1 para conferir');
    fireEvent.click(within(card).getByRole('button', { name: 'Conferir agora' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/conferir'));
  });

  it('US-15 (UXB-006, UXB-024): Filtros fica fora dos chips, conta os filtros ativos e o Status diz "Todos"', async () => {
    mount(await seeded(), '/lancamentos', <TransactionsScreen today={TODAY} />);
    await screen.findByTestId('tx-pad');
    const chips = screen.getByRole('group', { name: 'Filtros' });
    expect(within(chips).queryByRole('button', { name: /Filtros/ })).toBeNull();
    const filters = screen.getByTestId('list-filters');
    fireEvent.click(filters);
    const status = (await screen.findByLabelText('Status')) as HTMLSelectElement;
    expect(status.options[0]?.textContent).toBe('Todos');
    expect((screen.getByLabelText('Conta') as HTMLSelectElement).options[0]?.textContent).toBe(
      'Todas',
    );
    fireEvent.change(status, { target: { value: 'forecast' } });
    expect(filters).toHaveTextContent('Filtros1');
    // a busca continua com o rótulo para o leitor de tela
    expect(screen.getByLabelText('Buscar lançamentos')).toHaveAttribute(
      'placeholder',
      'Buscar lançamentos',
    );
  });
});

describe('T-122: T02', () => {
  it('US-20 (UXB-009): a parcela mostra "1 de 3", a lista da série com a atual destacada e a descrição no herói', async () => {
    const auth = await seeded();
    mount(
      { ...auth, client: null },
      '/lancamentos/p1',
      <TransactionDetailScreen today={TODAY} />,
      '/lancamentos/:id',
    );
    expect(await screen.findByTestId('detail-title')).toHaveTextContent('Notebook');
    const list = screen.getByTestId('detail-list');
    expect(within(list).getByText('Parcela').nextElementSibling).toHaveTextContent('1 de 3');
    expect(within(list).queryByText('Tipo')).toBeNull();
    expect(within(list).queryByText('Status')).toBeNull();
    expect(within(list).queryByText('Observação')).toBeNull();
    const series = screen.getByTestId('detail-series');
    const items = within(series).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '1/3 · nov/2026',
      '2/3 · dez/2026',
      '3/3 · jan/2027',
    ]);
    expect(items[0]).toHaveAttribute('aria-current', 'true');
  });

  it('US-14 (UXB-022): "Excluir" vem por último e sem o vermelho cheio, no avulso e na parcela', async () => {
    const auth = await seeded();
    mount(
      { ...auth, client: null },
      '/lancamentos/p1',
      <TransactionDetailScreen today={TODAY} />,
      '/lancamentos/:id',
    );
    await screen.findByTestId('detail-title');
    const actions = document.querySelector('.detail-actions');
    const buttons = [...(actions?.querySelectorAll(':scope > button') ?? [])];
    expect(buttons[0]?.textContent).toBe('Editar');
    const last = buttons.at(-1);
    expect(last?.textContent).toBe('Excluir');
    expect(last?.getAttribute('data-variant')).toBe('secondary');
  });

  it('US-14 (UXB-022): no avulso, "Excluir" também é o último e secundário', async () => {
    const auth = await seeded();
    mount(
      { ...auth, client: null },
      '/lancamentos/pad',
      <TransactionDetailScreen today={TODAY} />,
      '/lancamentos/:id',
    );
    await screen.findByTestId('detail-title');
    const buttons = [
      ...(document.querySelector('.detail-actions')?.querySelectorAll(':scope > button') ?? []),
    ];
    expect(buttons[0]?.textContent).toBe('Editar');
    expect(buttons.at(-1)?.textContent).toBe('Excluir');
    expect(buttons.at(-1)?.getAttribute('data-variant')).toBe('secondary');
  });
});
