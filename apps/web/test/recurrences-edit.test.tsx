import { recurrenceTxId, todayIn } from '@oakfinance/domain';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AutoPosts } from '../src/app/AutoPosts';
import { AuthContext } from '../src/app/auth';
import type { LocalRow, OakDb } from '../src/data/db';
import { txFromRow } from '../src/data/mappers';
import { IncomeScreen } from '../src/features/recurrences/IncomeScreen';
import {
  buildFixedExpense,
  confirmOccurrence,
  editOneOccurrence,
  endRecurrence,
  projectIncome,
  recurrenceFromRow,
  skipOccurrence,
  splitRecurrence,
} from '../src/features/recurrences/model';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

const USER = '00000000-0000-7000-8000-000000000001';

function aluguel(): LocalRow<'recurrences'> {
  return buildFixedExpense({
    id: 'rec-aluguel',
    userId: USER,
    description: 'Aluguel',
    amountCents: 150_000,
    dayOfMonth: 10,
    accountId: 'bb',
    cardId: null,
    categoryId: null,
    variable: false,
    startOn: '2026-09-01',
    nowIso: '2026-09-01T12:00:00.000Z',
  });
}

const domain = (row: LocalRow<'recurrences'>) => {
  const rec = recurrenceFromRow(row);
  if (!rec) {
    throw new Error('recorrência inválida');
  }
  return rec;
};

async function withRent(): Promise<{ db: OakDb; row: LocalRow<'recurrences'> }> {
  const auth = fakeAuth('signedIn');
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem banco');
  }
  const row = aluguel();
  await db.recurrences.put(row);
  for (const date of ['2026-09-10', '2026-10-10', '2026-11-10']) {
    await confirmOccurrence(db, USER, domain(row), date, 150_000);
  }
  return { db, row };
}

async function projection(db: OakDb, today: string) {
  const recs = (await db.recurrences.toArray()).flatMap((r) => {
    const rec = r.deleted_at === null ? recurrenceFromRow(r) : null;
    return rec ? [rec] : [];
  });
  const txs = (await db.transactions.toArray()).map(txFromRow);
  return projectIncome(recs, txs, today);
}

describe('recurrences — editar, pular e encerrar (US-26, RN-30)', () => {
  it('US-26: reajuste de jan/2027 para R$ 1.600,00 com "Esta e as próximas" encerra a original em 09/01/2027 e cria a nova em 10/01/2027', async () => {
    const { db, row } = await withRent();
    const result = await splitRecurrence(db, row, '2027-01-10', 160_000);
    if (!result.ok) {
      throw new Error('não dividiu');
    }
    expect(await db.recurrences.get(row.id)).toMatchObject({
      end_on: '2027-01-09',
      amount_cents: 150_000,
    });
    expect(result.value).toMatchObject({
      start_on: '2027-01-10',
      amount_cents: 160_000,
      day_of_month: 10,
    });
    const occ = await projection(db, '2026-11-15');
    const byDate = new Map(occ.map((o) => [o.date, o]));
    expect(byDate.get('2026-11-10')).toMatchObject({ amountCents: 150_000, recurrenceId: row.id });
    expect(byDate.get('2026-12-10')).toMatchObject({ amountCents: 150_000, recurrenceId: row.id });
    expect(byDate.get('2027-01-10')).toMatchObject({
      amountCents: 160_000,
      recurrenceId: result.value.id,
    });
    expect(byDate.get('2027-06-10')).toMatchObject({ amountCents: 160_000 });
    expect(occ.filter((o) => o.date === '2027-01-10')).toHaveLength(1);
    // as efetivadas não mudam
    expect((await db.transactions.get(recurrenceTxId(row.id, '2026-11-10')))?.amount_cents).toBe(
      150_000,
    );
  });

  it('US-26: "Pular este mês" em dez/2026 deixa a ocorrência cancelada (fora do mês)', async () => {
    const { db, row } = await withRent();
    await skipOccurrence(db, USER, domain(row), '2026-12-10');
    expect((await db.transactions.get(recurrenceTxId(row.id, '2026-12-10')))?.status).toBe(
      'cancelled',
    );
    const dec = (await projection(db, '2026-12-01')).find((o) => o.date === '2026-12-10');
    expect(dec?.realizedTxId).toBe(recurrenceTxId(row.id, '2026-12-10'));
  });

  it('US-26: encerrar em 30/11/2026 tira as previstas depois e mantém as efetivadas', async () => {
    const { db, row } = await withRent();
    // uma ocorrência futura com valor só nela (pendente) também sai
    await editOneOccurrence(db, USER, domain(row), '2027-02-10', 155_000, '2026-11-15');
    expect((await db.transactions.get(recurrenceTxId(row.id, '2027-02-10')))?.status).toBe(
      'pending',
    );
    await endRecurrence(db, row, '2026-11-30');
    expect((await db.recurrences.get(row.id))?.end_on).toBe('2026-11-30');
    expect(
      (await db.transactions.get(recurrenceTxId(row.id, '2027-02-10')))?.deleted_at,
    ).not.toBeNull();
    for (const date of ['2026-09-10', '2026-10-10', '2026-11-10']) {
      expect((await db.transactions.get(recurrenceTxId(row.id, date)))?.status).toBe('posted');
    }
    const after = (await projection(db, '2026-11-15')).filter((o) => o.date > '2026-11-30');
    expect(after).toEqual([]);
  });

  it('RN-30 "Só esta": de hoje para trás fica efetivada; futura fica pendente com o valor novo', async () => {
    const { db, row } = await withRent();
    await editOneOccurrence(db, USER, domain(row), '2026-12-10', 149_000, '2026-12-15');
    expect(await db.transactions.get(recurrenceTxId(row.id, '2026-12-10'))).toMatchObject({
      status: 'posted',
      amount_cents: 149_000,
    });
    const rec = await db.recurrences.get(row.id);
    expect(rec?.amount_cents).toBe(150_000);
  });
});

describe('S05 — Mudar valor e Encerrar (UX §3 S01)', () => {
  it('US-26: pela tela, "Esta e as próximas" cria a nova recorrência e "Encerrar a partir desta" fecha a original', async () => {
    const auth = fakeAuth('signedIn');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await db.accounts.put(
      makeRow('accounts', {
        id: 'bb',
        name: 'BB',
        type: 'checking',
        deleted_at: null,
        archived_at: null,
      }),
    );
    await db.recurrences.put(aluguel());
    const router = createMemoryRouter([
      { path: '*', element: <IncomeScreen today="2026-11-05" /> },
    ]);
    render(
      <AuthContext.Provider value={auth}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthContext.Provider>,
    );
    const card = await screen.findByTestId('expense-rec-aluguel');
    fireEvent.click(within(card).getByRole('button', { name: 'Mudar valor' }));
    const sheet = await screen.findByTestId('recurrence-edit');
    fireEvent.change(within(sheet).getByLabelText('Ocorrência'), {
      target: { value: '2027-01-10' },
    });
    const amount = within(sheet).getByLabelText('Valor');
    fireEvent.keyDown(amount, { key: 'Delete' });
    for (const d of '160000') {
      fireEvent.keyDown(amount, { key: d });
    }
    expect(within(sheet).getByRole('radio', { name: 'Esta e as próximas' })).toBeChecked();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(async () => expect(await db.recurrences.count()).toBe(2));
    expect((await db.recurrences.get('rec-aluguel'))?.end_on).toBe('2027-01-09');
    fireEvent.click(
      within(await screen.findByTestId('expense-rec-aluguel')).getByRole('button', {
        name: 'Encerrar a partir desta',
      }),
    );
    const end = await screen.findByTestId('recurrence-end');
    fireEvent.click(within(end).getByRole('button', { name: 'Encerrar a partir desta' }));
    await waitFor(async () =>
      expect((await db.recurrences.get('rec-aluguel'))?.end_on).toBe('2026-11-05'),
    );
  });
});

describe('RN-28 depois do sync', () => {
  it('RN-28: depois do primeiro sync da sessão, a ocorrência automática vencida é confirmada uma vez', async () => {
    const auth = fakeAuth('signedIn');
    const user = auth.user;
    if (!user) {
      throw new Error('sem usuário');
    }
    const today = todayIn('America/Sao_Paulo', new Date());
    const day = Number(today.slice(8, 10));
    await user.db.accounts.put(
      makeRow('accounts', {
        id: 'bb',
        name: 'BB',
        type: 'checking',
        deleted_at: null,
        archived_at: null,
      }),
    );
    await user.db.recurrences.put({
      ...aluguel(),
      id: 'auto',
      auto_post: true,
      day_of_month: day,
      start_on: `${today.slice(0, 7)}-01`,
    });
    let snapshot = { ...user.engine.getSnapshot(), phase: 'idle' as const };
    const listeners = new Set<() => void>();
    vi.spyOn(user.engine, 'getSnapshot').mockImplementation(() => snapshot as never);
    vi.spyOn(user.engine, 'subscribe').mockImplementation((l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    });
    render(
      <AuthContext.Provider value={auth}>
        <AutoPosts />
      </AuthContext.Provider>,
    );
    expect(await user.db.transactions.count()).toBe(0);
    act(() => {
      snapshot = { ...snapshot, phase: 'done' as never };
      for (const l of listeners) {
        l();
      }
    });
    await waitFor(async () => expect(await user.db.transactions.count()).toBe(1));
  });
});
