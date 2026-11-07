// T-091: o aviso de conta fixa ou receita (UX 6.7 #3, #19, #20) abre a T02 da ocorrência, com as ações da US-41 e da
// RN-34 mesmo quando a ocorrência ainda não virou lançamento no aparelho.
import { type ISODate, recurrenceTxId } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { OakDb } from '../src/data/db';
import { saveRow } from '../src/data/repositories/rows';
import {
  buildFixedExpense,
  buildFixedIncome,
  holdOccurrence,
  recurrenceFromRow,
} from '../src/features/recurrences/model';
import { findOccurrence } from '../src/features/recurrences/OccurrenceActions';
import { TransactionDetailScreen } from '../src/features/transactions/TransactionDetailScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

const NOW = '2026-11-01T12:00:00.000Z';
const LUZ_ID = 'e4100000-0000-5000-8000-000000000001';
const SAL_ID = 'e4100000-0000-5000-8000-000000000002';

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

async function seed(auth: AuthValue) {
  const db = dbOf(auth);
  const userId = auth.user?.userId ?? '';
  await db.accounts.put(makeRow('accounts', { id: 'bb', name: 'BB', deleted_at: null }));
  const luz = buildFixedExpense({
    id: LUZ_ID,
    userId,
    description: 'Luz',
    amountCents: 18000,
    dayOfMonth: 20,
    accountId: 'bb',
    cardId: null,
    categoryId: null,
    variable: true,
    startOn: '2026-01-20',
    nowIso: NOW,
  });
  const salario = buildFixedIncome({
    id: SAL_ID,
    userId,
    description: 'Salário',
    amountCents: 500000,
    dayOfMonth: 5,
    accountId: 'bb',
    categoryId: null,
    startOn: '2026-01-05',
    nowIso: NOW,
  });
  await saveRow(db, 'recurrences', luz);
  await saveRow(db, 'recurrences', salario);
  return { luz, salario };
}

function open(auth: AuthValue, id: string, today: string) {
  const router = createMemoryRouter(
    [
      { path: '/lancamentos/:id', element: <TransactionDetailScreen today={today} /> },
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

describe('T-091: ocorrência pelo id do aviso', () => {
  it('US-41: o id v5 de uma ocorrência só projetada leva à recorrência e à data', async () => {
    const auth = fakeAuth();
    const { luz } = await seed(auth);
    const rows = await dbOf(auth).recurrences.toArray();
    const today = '2026-11-21' as ISODate;
    const found = findOccurrence(recurrenceTxId(LUZ_ID, '2026-11-20'), rows, null, today);
    expect(found).toMatchObject({ date: '2026-11-20', tx: null });
    expect(found?.rec.id).toBe(luz.id);
    expect(findOccurrence('outro-id', rows, null, today)).toBeNull();
  });
});

describe('T-091: T02 da conta fixa (US-41, RN-91, UX #19)', () => {
  it('US-41: "Confirmar Luz" com o aviso de atraso; Confirmar grava a ocorrência efetivada com o valor real', async () => {
    const auth = fakeAuth();
    await seed(auth);
    const id = recurrenceTxId(LUZ_ID, '2026-11-20');
    open(auth, id, '2026-11-21');
    expect(await screen.findByText('Confirmar Luz')).toBeDefined();
    expect(
      screen.getByText('Venceu em 20/11/2026. Confirme o pagamento ou pule este mês.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(async () =>
      expect(await dbOf(auth).transactions.get(id)).toMatchObject({
        status: 'posted',
        amount_cents: 18000,
        recurrence_id: LUZ_ID,
        recurrence_date: '2026-11-20',
      }),
    );
  });

  it('US-41: na véspera, "Vence em 20/11/2026."; Pular este mês cancela a ocorrência', async () => {
    const auth = fakeAuth();
    await seed(auth);
    const id = recurrenceTxId(LUZ_ID, '2026-11-20');
    open(auth, id, '2026-11-19');
    expect(await screen.findByText('Vence em 20/11/2026.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Pular este mês' }));
    await waitFor(async () =>
      expect((await dbOf(auth).transactions.get(id))?.status).toBe('cancelled'),
    );
  });

  it('RN-91: ocorrência já lançada e prevista mostra as ações junto do detalhe; confirmada, não', async () => {
    const auth = fakeAuth();
    const { luz } = await seed(auth);
    const rec = recurrenceFromRow(luz);
    if (!rec) {
      throw new Error('sem recorrência');
    }
    await holdOccurrence(dbOf(auth), auth.user?.userId ?? '', rec, '2026-11-20', 18000);
    const id = recurrenceTxId(LUZ_ID, '2026-11-20');
    open(auth, id, '2026-11-21');
    expect(await screen.findByTestId('detail-list')).toBeDefined();
    expect(await screen.findByTestId('occurrence-actions')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(screen.queryByTestId('occurrence-actions')).toBeNull());
    expect((await dbOf(auth).transactions.get(id))?.status).toBe('posted');
  });
});

describe('T-091: T02 da receita (RN-34, UX #20)', () => {
  it('RN-34: "Confirmar Salário" com Prevista para; Não vai cair cancela', async () => {
    const auth = fakeAuth();
    await seed(auth);
    const id = recurrenceTxId(SAL_ID, '2026-12-05');
    open(auth, id, '2026-12-06');
    expect(await screen.findByText('Confirmar Salário')).toBeDefined();
    expect(
      screen.getByText('Prevista para 05/12/2026. Confirme o valor recebido ou mude a data.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Não vai cair' }));
    await waitFor(async () =>
      expect((await dbOf(auth).transactions.get(id))?.status).toBe('cancelled'),
    );
  });

  it('RN-34: Mudar data grava a ocorrência ainda prevista e abre a edição', async () => {
    const auth = fakeAuth();
    await seed(auth);
    const id = recurrenceTxId(SAL_ID, '2026-12-05');
    const router = open(auth, id, '2026-12-06');
    fireEvent.click(await screen.findByRole('button', { name: 'Mudar data' }));
    await waitFor(() => expect(router.state.location.search).toBe(`?editar=${id}`));
    expect(await dbOf(auth).transactions.get(id)).toMatchObject({
      status: 'pending',
      amount_cents: 500000,
    });
  });
});
