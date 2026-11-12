import {
  type Account,
  type Category,
  type MonthInput,
  monthlyIncome,
  recurrenceTxId,
  type Tx,
} from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { txFromRow } from '../src/data/mappers';
import { ensureSeeds } from '../src/data/seeds';
import {
  fixedIncomeProblem,
  IncomeScreen,
  occurrenceText,
} from '../src/features/recurrences/IncomeScreen';
import {
  buildFixedIncome,
  confirmOccurrence,
  occurrenceRow,
  projectIncome,
  recurrenceFromRow,
  skipOccurrence,
} from '../src/features/recurrences/model';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

const TODAY = '2026-11-03';
const USER = '00000000-0000-7000-8000-000000000001';

function salaryRow(overrides: Partial<LocalRow<'recurrences'>> = {}): LocalRow<'recurrences'> {
  return {
    ...buildFixedIncome({
      id: 'rec-salario',
      userId: USER,
      description: 'Salário',
      amountCents: 500_000,
      dayOfMonth: 5,
      accountId: 'bb',
      categoryId: 'cat-salario',
      startOn: '2026-11-01',
      nowIso: '2026-11-01T12:00:00.000Z',
    }),
    ...overrides,
  };
}

function salary() {
  const rec = recurrenceFromRow(salaryRow());
  if (!rec) {
    throw new Error('recorrência inválida');
  }
  return rec;
}

function base(txs: Tx[], month = '2026-11'): number {
  const input: MonthInput = {
    month: month as MonthInput['month'],
    today: TODAY,
    txs,
    recurrences: [salary()],
    cards: [],
    accounts: [] as Account[],
    categories: [] as Category[],
    invoiceMonthById: new Map(),
    attribution: 'invoice_due_month',
    includeRestrictedAccounts: false,
  };
  return monthlyIncome(input).fixedCents;
}

describe('recurrences — receita fixa (US-23, RN-26..RN-28, RN-32)', () => {
  it('US-23: "Salário" de R$ 5.000,00 todo dia 5 na conta BB é projetado até o último dia de M+12 (RN-27)', () => {
    const occ = projectIncome([salary()], [], TODAY);
    expect(occ[0]).toMatchObject({ date: '2026-11-05', amountCents: 500_000, realizedTxId: null });
    expect(occ.at(-1)?.date).toBe('2027-11-05');
    expect(occ).toHaveLength(13);
    expect(salaryRow()).toMatchObject({ is_fixed_income: true, auto_post: false, kind: 'income' });
  });

  it('US-23: a Base do mês corrente inclui R$ 5.000,00 mesmo antes do dia 5 (RN-32)', () => {
    expect(base([])).toBe(500_000);
  });

  it('US-23: confirmar novembro com R$ 4.870,00 efetiva a ocorrência e a Base usa R$ 4.870,00', () => {
    const row = occurrenceRow(
      salary(),
      '2026-11-05',
      { status: 'posted', amountCents: 487_000 },
      undefined,
      USER,
      '2026-11-05T12:00:00.000Z',
    );
    expect(row).toMatchObject({
      id: recurrenceTxId('rec-salario', '2026-11-05'),
      status: 'posted',
      amount_cents: 487_000,
      recurrence_id: 'rec-salario',
      recurrence_date: '2026-11-05',
      kind: 'income',
      account_id: 'bb',
      source: 'recurrence',
    });
    expect(base([txFromRow(row)])).toBe(487_000);
  });

  it('US-23: "Não recebi este mês" cancela a ocorrência e ela sai da Base', () => {
    const row = occurrenceRow(
      salary(),
      '2026-11-05',
      { status: 'cancelled' },
      undefined,
      USER,
      '2026-11-05T12:00:00.000Z',
    );
    expect(row.status).toBe('cancelled');
    expect(base([txFromRow(row)])).toBe(0);
    expect(base([txFromRow(row)], '2026-12')).toBe(500_000);
  });

  it('US-23: dois aparelhos que confirmam 05/12/2026 gravam a mesma linha (id determinístico)', async () => {
    const a = fakeAuth('signedIn');
    const b = fakeAuth('signedIn');
    const rec = salary();
    await confirmOccurrence(
      a.user?.db as never,
      USER,
      rec,
      '2026-12-05',
      500_000,
      Date.UTC(2026, 11, 5, 10),
    );
    await confirmOccurrence(
      b.user?.db as never,
      USER,
      rec,
      '2026-12-05',
      510_000,
      Date.UTC(2026, 11, 5, 11),
    );
    const id = recurrenceTxId('rec-salario', '2026-12-05');
    const [ra, rb] = await Promise.all([
      a.user?.db.transactions.get(id),
      b.user?.db.transactions.get(id),
    ]);
    expect(ra?.id).toBe(id);
    expect(rb?.id).toBe(id);
    expect((rb?.client_updated_at ?? '') > (ra?.client_updated_at ?? '')).toBe(true);
    // confirmar de novo no mesmo aparelho atualiza a mesma linha
    await skipOccurrence(a.user?.db as never, USER, rec, '2026-12-05');
    expect(await a.user?.db.transactions.where('recurrence_id').equals('rec-salario').count()).toBe(
      1,
    );
    expect((await a.user?.db.transactions.get(id))?.status).toBe('cancelled');
  });

  it('textos da ocorrência e validação do cadastro', () => {
    const [nov] = projectIncome([salary()], [], TODAY);
    if (!nov) {
      throw new Error('sem ocorrência');
    }
    expect(occurrenceText(nov, undefined, TODAY, false)).toBe(
      'Prevista para 05/11/2026 · R$\u00A05.000,00',
    );
    expect(occurrenceText(nov, undefined, '2026-11-06', false)).toBe(
      'Atrasada desde 05/11/2026 · R$\u00A05.000,00',
    );
    expect(occurrenceText(nov, undefined, TODAY, true)).toBe(
      'Prevista para 05/11/2026 · R$\u00A0••••',
    );
    const draft = {
      description: 'Salário',
      amount: 500_000,
      day: '5',
      accountId: 'bb',
      categoryId: '',
    };
    expect(fixedIncomeProblem(draft)).toBeNull();
    expect(fixedIncomeProblem({ ...draft, description: ' ' })).toBe('Informe a descrição.');
    expect(fixedIncomeProblem({ ...draft, amount: 0 })).toBe('Informe o valor.');
    expect(fixedIncomeProblem({ ...draft, day: '32' })).toBe('Escolha um dia entre 1 e 31.');
    expect(fixedIncomeProblem({ ...draft, accountId: '' })).toBe('Escolha a conta.');
    expect(recurrenceFromRow({ ...salaryRow(), frequency: 'x' })).toBeNull();
  });
});

function mount(auth: AuthValue) {
  const router = createMemoryRouter([{ path: '*', element: <IncomeScreen today={TODAY} /> }]);
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('S05 — Renda (UX §3 S01)', () => {
  it('US-23: cadastra o salário, confirma novembro com R$ 4.870,00 e mostra as próximas', async () => {
    const auth = fakeAuth('signedIn');
    const user = auth.user;
    if (!user) {
      throw new Error('sem usuário');
    }
    await ensureSeeds(user.db, user.userId);
    await user.db.accounts.put(
      makeRow('accounts', { id: 'bb', name: 'BB', deleted_at: null, archived_at: null }),
    );
    mount(auth);
    expect(await screen.findByText('Nenhuma receita fixa cadastrada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nova receita fixa' }));
    const sheet = await screen.findByTestId('fixed-sheet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Informe a descrição.');
    fireEvent.change(within(sheet).getByLabelText('Descrição'), { target: { value: 'Salário' } });
    const amount = within(sheet).getByLabelText('Valor');
    for (const digit of '500000') {
      fireEvent.keyDown(amount, { key: digit });
    }
    fireEvent.change(within(sheet).getByLabelText('Dia do mês'), { target: { value: '5' } });
    expect(within(sheet).getByLabelText('Categoria')).toHaveDisplayValue('Salário');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Receita fixa salva.')).toBeInTheDocument();
    const card = await screen.findByRole('heading', { name: 'Salário', level: 2 });
    expect(card).toBeInTheDocument();
    expect(await screen.findByTestId('fixed-current')).toHaveTextContent(
      'Prevista para 05/11/2026 · R$ 5.000,00',
    );
    expect(screen.getByTestId('fixed-upcoming')).toHaveTextContent('Prevista para 05/12/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    const confirm = await screen.findByTestId('confirm-sheet');
    const real = within(confirm).getByLabelText('Valor');
    fireEvent.keyDown(real, { key: 'Delete' });
    for (const digit of '487000') {
      fireEvent.keyDown(real, { key: digit });
    }
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    // (o toast "Receita confirmada." espera na fila atrás do "Receita fixa salva.")
    await waitFor(() =>
      expect(screen.getByTestId('fixed-current')).toHaveTextContent(
        'Recebida em 05/11/2026 · R$ 4.870,00',
      ),
    );
    const [rec] = await user.db.recurrences.toArray();
    expect(rec).toMatchObject({ description: 'Salário', amount_cents: 500_000, day_of_month: 5 });
  });

  it('US-23: "Não recebi este mês" deixa a ocorrência não recebida', async () => {
    const auth = fakeAuth('signedIn');
    const user = auth.user;
    if (!user) {
      throw new Error('sem usuário');
    }
    await user.db.accounts.put(
      makeRow('accounts', { id: 'bb', name: 'BB', deleted_at: null, archived_at: null }),
    );
    await user.db.recurrences.put(salaryRow());
    mount(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Não recebi este mês' }));
    expect(await screen.findByText('Receita marcada como não recebida.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('fixed-current')).toHaveTextContent('Não recebida em nov/2026'),
    );
    const id = recurrenceTxId('rec-salario', '2026-11-05');
    expect((await user.db.transactions.get(id))?.status).toBe('cancelled');
  });

  it('sem conta, o cadastro pede uma conta', async () => {
    const auth = fakeAuth('signedIn');
    mount(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Nova receita fixa' }));
    expect(await screen.findByText('Cadastre uma conta para receber a renda.')).toBeInTheDocument();
  });
});
