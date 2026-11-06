import type { SupabaseClient } from '@supabase/supabase-js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import { RemoteEditsToast, remoteEditsMessage } from '../src/app/RemoteEditsToast';
import { deviceId } from '../src/data/sync/clock';
import {
  isStandalone,
  TransactionDetailScreen,
} from '../src/features/transactions/TransactionDetailScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-06';

function historyClient(data: unknown, error: unknown = null) {
  return { rpc: vi.fn(() => Promise.resolve({ data, error })) } as unknown as SupabaseClient;
}

async function setup(auth: AuthValue, id = 'l1') {
  const router = createMemoryRouter(
    [
      {
        path: '/lancamentos/:id',
        element: <TransactionDetailScreen today={TODAY} />,
      },
      { path: '/lancamentos', element: <p>lista</p> },
    ],
    { initialEntries: [`/lancamentos/${id}`] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  return router;
}

async function seed(auth: AuthValue, overrides: Partial<ReturnType<typeof tx>> = {}) {
  const user = auth.user;
  if (!user) {
    throw new Error('sem usuário');
  }
  await user.db.categories.put(
    makeRow('categories', { id: 'mercado', name: 'Mercado', deleted_at: null }),
  );
  await user.db.cards.put(makeRow('cards', { id: 'nu', name: 'Nubank', deleted_at: null }));
  await user.db.invoices.put(
    makeRow('invoices', {
      id: 'f1',
      card_id: 'nu',
      reference_month: '2026-12-01',
      due_date: '2026-12-10',
    }),
  );
  await user.db.transactions.put(
    tx('l1', {
      amount_cents: 4590,
      category_id: 'mercado',
      payment_method: 'credit',
      card_id: 'nu',
      invoice_id: 'f1',
      occurred_on: '2026-11-05',
      description: 'Padaria',
      notes: null,
      source: 'manual',
      series_id: null,
      recurrence_id: null,
      deleted_at: null,
      ...overrides,
    }),
  );
  return user;
}

const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
afterEach(() => {
  if (online) {
    Object.defineProperty(Navigator.prototype, 'onLine', online);
  }
});

describe('T02 — detalhe do lançamento (US-13, US-14)', () => {
  it('US-13: mostra os dados em <dl> e o histórico com a versão anterior', async () => {
    const auth = fakeAuth('signedIn');
    const user = await seed(auth);
    const device = await deviceId(user.db);
    const client = historyClient([
      {
        op: 'update',
        old_row: { ...(await user.db.transactions.get('l1')), amount_cents: 4950 },
        device_id: device,
        changed_at: '2026-11-06T21:02:00.000Z',
      },
    ]);
    await setup({ ...auth, client });
    const list = await screen.findByTestId('detail-list');
    expect(list.tagName).toBe('DL');
    expect(within(list).getByText('Mercado')).toBeInTheDocument();
    expect(within(list).getByText('Nubank')).toBeInTheDocument();
    expect(within(list).getByText('dez/2026, vence 10/12/2026')).toBeInTheDocument();
    expect(within(list).getByText('05/11/2026')).toBeInTheDocument();
    expect(within(list).getByText('Manual')).toBeInTheDocument();
    expect(screen.getByTestId('detail-amount')).toHaveTextContent('R$ 45,90');
    const item = await screen.findByTestId('history-item');
    expect(item).toHaveTextContent('Valor alterado de R$ 49,50 para R$ 45,90');
    expect(item).toHaveTextContent('Hoje 18:02 · neste aparelho');
    fireEvent.click(within(item).getByRole('button', { name: 'Restaurar esta versão' }));
    await waitFor(async () =>
      expect(await user.db.transactions.get('l1')).toMatchObject({
        amount_cents: 4950,
        _pending: 1,
      }),
    );
    expect(await screen.findByText('Versão restaurada.')).toBeInTheDocument();
  });

  it('US-14: excluir avulso some na hora, volta à lista e o toast oferece Desfazer', async () => {
    const auth = fakeAuth('signedIn');
    const user = await seed(auth);
    const router = await setup({ ...auth, client: historyClient([]) });
    expect(await screen.findByText('Nenhuma alteração registrada.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(async () =>
      expect((await user.db.transactions.get('l1'))?.deleted_at).not.toBeNull(),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/lancamentos'));
    expect(await screen.findByText('Lançamento excluído.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () =>
      expect((await user.db.transactions.get('l1'))?.deleted_at).toBeNull(),
    );
  });

  it('Editar abre o Q01 em modo edição pelo ?editar=', async () => {
    const auth = fakeAuth('signedIn');
    await seed(auth);
    const router = await setup({ ...auth, client: historyClient([]) });
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    await waitFor(() => expect(router.state.location.search).toBe('?editar=l1'));
  });

  it('RN-25: parcela e ocorrência de recorrência não mostram Excluir (T-053/T-055)', async () => {
    expect(isStandalone(tx('a', { series_id: null, recurrence_id: null }))).toBe(true);
    expect(isStandalone(tx('a', { series_id: 's', recurrence_id: null }))).toBe(false);
    expect(isStandalone(tx('a', { series_id: null, recurrence_id: 'r' }))).toBe(false);
    const auth = fakeAuth('signedIn');
    await seed(auth, { series_id: 's1', installment_number: 1, installment_count: 10 });
    await setup({ ...auth, client: historyClient([]) });
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
  });

  it('RN-98: sem conexão o histórico mostra "Disponível com conexão"', async () => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    const auth = fakeAuth('signedIn');
    await seed(auth);
    const client = historyClient([]);
    await setup({ ...auth, client });
    expect(await screen.findByText('Disponível com conexão')).toBeInTheDocument();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('falha da RPC mostra o erro; lançamento inexistente mostra o vazio com Voltar', async () => {
    const auth = fakeAuth('signedIn');
    await seed(auth);
    await setup({ ...auth, client: historyClient(null, { code: '500' }) });
    expect(await screen.findByText('Não foi possível carregar o histórico.')).toBeInTheDocument();
  });

  it('lançamento inexistente mostra "Lançamento não encontrado." e volta à lista', async () => {
    const auth = fakeAuth('signedIn');
    const router = await setup({ ...auth, client: historyClient([]) }, 'nao-existe');
    expect(await screen.findByText('Lançamento não encontrado.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para lançamentos' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/lancamentos'));
  });
});

describe('G06 — editado em outro aparelho', () => {
  it('G06: texto no singular e no plural', () => {
    expect(remoteEditsMessage(1)).toBe('1 lançamento foi atualizado a partir de outro aparelho.');
    expect(remoteEditsMessage(3)).toBe(
      '3 lançamentos foram atualizados a partir de outro aparelho.',
    );
  });

  it('G06: toast uma vez por pull com edição de outro aparelho', async () => {
    const auth = fakeAuth('signedIn');
    const engine = auth.user?.engine;
    if (!engine) {
      throw new Error('sem motor');
    }
    let snapshot = engine.getSnapshot();
    const listeners = new Set<() => void>();
    const emit = (patch: Partial<typeof snapshot>) => {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) {
        listener();
      }
    };
    vi.spyOn(engine, 'getSnapshot').mockImplementation(() => snapshot);
    vi.spyOn(engine, 'subscribe').mockImplementation((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RemoteEditsToast />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    expect(screen.getByTestId('toast-region')).toBeEmptyDOMElement();
    act(() => emit({ remoteEdits: 1, remoteEditsSeq: 1 }));
    const message = '1 lançamento foi atualizado a partir de outro aparelho.';
    expect(await screen.findByText(message)).toBeInTheDocument();
    act(() => emit({ phase: 'done' }));
    expect(screen.getAllByText(message)).toHaveLength(1);
  });
});
