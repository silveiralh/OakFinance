import { recurrenceTxId } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { createAccount } from '../src/data/repositories/accounts';
import { dueScheduledExpenses, promoteDueExpenses } from '../src/data/scheduled';
import { ensureSeeds } from '../src/data/seeds';
import { IncomeToConfirm } from '../src/features/dashboard/IncomeToConfirm';
import { isFarDate, overdueIncomes, statusFor } from '../src/features/quick-entry/model';
import { QuickEntrySheet } from '../src/features/quick-entry/QuickEntrySheet';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { tx } from './data/rows';

const TODAY = '2026-11-05';

async function setup() {
  const auth = fakeAuth('signedIn');
  const user = auth.user;
  if (!user) {
    throw new Error('sem usuário');
  }
  await ensureSeeds(user.db, user.userId);
  await createAccount(
    user.db,
    user.userId,
    { name: 'BB', type: 'checking', initialBalanceOn: TODAY },
    { id: 'bb' },
  );
  return auth;
}

function mount(
  auth: ReturnType<typeof fakeAuth>,
  props: { mode?: 'expense' | 'income'; editId?: string } = {},
) {
  const onClose = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <ToastProvider>
            <QuickEntrySheet onClose={onClose} today={TODAY} {...props} />
          </ToastProvider>
        ),
      },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
  return onClose;
}

function type(digits: string) {
  const input = screen.getByRole('textbox', { name: 'Valor' });
  for (const d of digits) {
    fireEvent.keyDown(input, { key: d });
  }
}

async function openDetails() {
  fireEvent.click(await screen.findByTestId('quick-details'));
}

function setDate(value: string) {
  const input = document.querySelector('input[type="date"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

async function submitted(auth: ReturnType<typeof fakeAuth>) {
  await waitFor(async () => expect(await auth.user?.db.transactions.count()).toBe(1));
  return (await auth.user?.db.transactions.toArray())?.[0];
}

describe('US-13: lançamento completo', () => {
  it('RN-05: despesa com data 20/11/2026 (hoje 05/11) fica prevista, "agendada", e na data vira efetivada', async () => {
    const auth = await setup();
    mount(auth);
    type('5000');
    fireEvent.click(await screen.findByRole('radio', { name: /Mercado/ }));
    await openDetails();
    setDate('2026-11-20');
    expect(await screen.findByText('Agendada para 20/11/2026')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('quick-submit'));
    const saved = await submitted(auth);
    expect(saved).toMatchObject({ status: 'pending', occurred_on: '2026-11-20' });
    const db = auth.user?.db;
    if (!db || !saved) {
      throw new Error('sem lançamento');
    }
    expect(await promoteDueExpenses(db, '2026-11-19')).toBe(0);
    expect(await promoteDueExpenses(db, '2026-11-20')).toBe(1);
    expect((await db.transactions.get(saved.id))?.status).toBe('posted');
    expect(
      dueScheduledExpenses(
        [tx('r', { status: 'pending', recurrence_id: 'x', occurred_on: TODAY })],
        TODAY,
      ),
    ).toEqual([]);
  });

  it('RN-06: data a mais de 60 dias pede "Essa data está longe de hoje. Confirmar?"', async () => {
    expect(isFarDate('2027-01-05', TODAY)).toBe(true);
    expect(isFarDate('2026-09-05', TODAY)).toBe(true);
    expect(isFarDate('2027-01-04', TODAY)).toBe(false);
    const auth = await setup();
    mount(auth);
    type('1000');
    fireEvent.click(await screen.findByRole('radio', { name: /Mercado/ }));
    await openDetails();
    setDate('2026-08-01');
    fireEvent.click(screen.getByTestId('quick-submit'));
    expect(await screen.findByText('Essa data está longe de hoje. Confirmar?')).toBeInTheDocument();
    expect(await auth.user?.db.transactions.count()).toBe(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Lançar' }).at(-1) as HTMLElement);
    const saved = await submitted(auth);
    expect(saved?.occurred_on).toBe('2026-08-01');
  });

  it('RN-61: "Posto Ipiranga" sugere Combustível (marcada como sugerida), mas não troca Mercado já escolhido', async () => {
    const auth = await setup();
    mount(auth);
    // espera as categorias e regras carregarem do banco local
    await screen.findByRole('radio', { name: /Mercado/ });
    await openDetails();
    fireEvent.change(await screen.findByLabelText('Descrição'), {
      target: { value: 'Posto Ipiranga' },
    });
    await waitFor(() => expect(screen.getByRole('radio', { name: /Combustível/ })).toBeChecked());
    expect(
      screen.getByRole('radio', { name: /Combustível/ }).closest('label')?.textContent,
    ).toMatch(/sugerida/);
    fireEvent.click(screen.getByRole('radio', { name: /Mercado/ }));
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Posto Shell' } });
    expect(screen.getByRole('radio', { name: /Mercado/ })).toBeChecked();
    type('8000');
    fireEvent.click(screen.getByTestId('quick-submit'));
    const saved = await submitted(auth);
    expect(saved).toMatchObject({ description: 'Posto Shell', category_source: 'manual' });
  });

  it('US-13: editar muda o valor de R$ 45,90 para R$ 49,50 pelo Q01 ("Editar lançamento" / "Salvar alterações")', async () => {
    const auth = await setup();
    const db = auth.user?.db;
    const mercado = (await db?.categories.where('slug').equals('mercado').first())?.id ?? null;
    await db?.transactions.put(
      tx('t1', { amount_cents: 4590, category_id: mercado, account_id: 'bb', notes: 'feira' }),
    );
    const onClose = mount(auth, { editId: 't1' });
    expect(await screen.findByText('Editar lançamento')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('R$ 45,90'),
    );
    const input = screen.getByRole('textbox', { name: 'Valor' });
    for (let i = 0; i < 4; i += 1) {
      fireEvent.keyDown(input, { key: 'Backspace' });
    }
    type('4950');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await db?.transactions.get('t1')).toMatchObject({
      amount_cents: 4950,
      notes: 'feira',
      _pending: 1,
    });
    expect((await db?.outbox.toArray())?.at(-1)?.row).toMatchObject({ amount_cents: 4950 });
  });
});

describe('US-24: receita variável', () => {
  async function income(
    answer: 'Sim' | 'Não',
    { countBefore = false, date }: { countBefore?: boolean; date?: string } = {},
  ) {
    const auth = await setup();
    mount(auth, { mode: 'income' });
    type('80000');
    fireEvent.click(await screen.findByRole('radio', { name: /Renda extra/ }));
    fireEvent.click(screen.getByRole('radio', { name: answer }));
    if (countBefore) {
      fireEvent.click(screen.getByRole('switch', { name: 'Contar antes de receber' }));
    }
    await openDetails();
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Freela' } });
    if (date) {
      setDate(date);
    }
    fireEvent.click(screen.getByTestId('quick-submit'));
    return submitted(auth);
  }

  it('Já caiu: Recebida (efetivada)', async () => {
    expect(await income('Sim')).toMatchObject({
      kind: 'income',
      status: 'posted',
      description: 'Freela',
      count_before_received: false,
    });
  });

  it('A receber (padrão): prevista e sem contar antes', async () => {
    expect(await income('Não', { date: '2026-11-25' })).toMatchObject({
      status: 'pending',
      count_before_received: false,
      occurred_on: '2026-11-25',
    });
  });

  it('Prevista: "Contar antes de receber" ligado', async () => {
    expect(await income('Não', { countBefore: true, date: '2026-11-25' })).toMatchObject({
      status: 'pending',
      count_before_received: true,
    });
    expect(statusFor('income', '2026-11-25', TODAY, true)).toBe('pending');
  });

  it('RN-34: em 26/11, "Confirmar Freela" com Confirmar, Mudar data e Não vai cair', async () => {
    const auth = await setup();
    const db = auth.user?.db;
    await db?.transactions.bulkPut([
      tx('f1', {
        kind: 'income',
        status: 'pending',
        description: 'Freela',
        occurred_on: '2026-11-25',
      }),
      tx('f2', {
        kind: 'income',
        status: 'pending',
        description: 'Bônus',
        occurred_on: '2026-11-25',
      }),
    ]);
    expect(overdueIncomes((await db?.transactions.toArray()) ?? [], '2026-11-25')).toEqual([]);
    const router = createMemoryRouter(
      [{ path: '*', element: <IncomeToConfirm today="2026-11-26" /> }],
      {
        initialEntries: ['/'],
      },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const card = await screen.findByTestId('income-confirm-f1');
    expect(card).toHaveTextContent('Confirmar Freela');
    fireEvent.click(card.querySelectorAll('button')[0] as HTMLElement);
    await waitFor(async () => expect((await db?.transactions.get('f1'))?.status).toBe('posted'));
    const bonus = await screen.findByTestId('income-confirm-f2');
    fireEvent.click(bonus.querySelectorAll('button')[2] as HTMLElement);
    await waitFor(async () => expect((await db?.transactions.get('f2'))?.status).toBe('cancelled'));
    await db?.transactions.put(
      tx('f3', {
        kind: 'income',
        status: 'pending',
        description: 'Extra',
        occurred_on: '2026-11-20',
      }),
    );
    const extra = await screen.findByTestId('income-confirm-f3');
    await act(async () => {
      fireEvent.click(extra.querySelectorAll('button')[1] as HTMLElement);
    });
    expect(router.state.location.search).toBe('?editar=f3');
  });
});

describe('US-23: "Repetir todo mês" na receita', () => {
  it('US-23: cria a receita fixa no dia da data e o lançamento vira a ocorrência dessa data (id v5)', async () => {
    const auth = await setup();
    const onClose = mount(auth, { mode: 'income' });
    type('500000');
    fireEvent.click(await screen.findByRole('radio', { name: /Salário/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Sim' }));
    await openDetails();
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Salário' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir todo mês' }));
    fireEvent.click(screen.getByTestId('quick-submit'));
    await waitFor(async () => expect(await auth.user?.db.recurrences.count()).toBe(1));
    const [rec] = (await auth.user?.db.recurrences.toArray()) ?? [];
    expect(rec).toMatchObject({
      kind: 'income',
      is_fixed_income: true,
      amount_cents: 500_000,
      day_of_month: 5,
      start_on: TODAY,
      account_id: 'bb',
      description: 'Salário',
    });
    const tx = await submitted(auth);
    expect(tx).toMatchObject({
      recurrence_id: rec?.id,
      recurrence_date: TODAY,
      status: 'posted',
      amount_cents: 500_000,
    });
    expect(tx?.id).toBe(recurrenceTxId(rec?.id ?? '', TODAY));
    expect(await screen.findByText('Receita fixa salva.')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('US-23: "Repetir todo mês" com "Não" só cria a receita fixa (a ocorrência fica projetada)', async () => {
    const auth = await setup();
    mount(auth, { mode: 'income' });
    type('500000');
    fireEvent.click(await screen.findByRole('radio', { name: /Salário/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Não' }));
    await openDetails();
    fireEvent.click(screen.getByRole('switch', { name: 'Repetir todo mês' }));
    fireEvent.click(screen.getByTestId('quick-submit'));
    await waitFor(async () => expect(await auth.user?.db.recurrences.count()).toBe(1));
    expect(await auth.user?.db.transactions.count()).toBe(0);
    expect((await auth.user?.db.recurrences.toArray())?.[0]?.description).toBe('Salário');
  });
});
