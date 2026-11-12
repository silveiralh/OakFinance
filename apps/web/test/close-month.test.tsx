// T-082: P04 Fechar o mês (US-36, RN-77) e o aviso ao editar um mês fechado no Q01.
import { monthClosingId } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { OakDb } from '../src/data/db';
import { createAccount } from '../src/data/repositories/accounts';
import { ensureSeeds } from '../src/data/seeds';
import { CloseMonthScreen } from '../src/features/budget/CloseMonthScreen';
import {
  canClose,
  closeMonth,
  closingChecklist,
  confirmOpenInvoice,
  isMonthClosed,
  reopenMonth,
} from '../src/features/budget/closing';
import { loadHomeRows } from '../src/features/dashboard/data';
import { QuickEntrySheet } from '../src/features/quick-entry/QuickEntrySheet';
import { TELEMETRY_KEY } from '../src/lib/telemetry';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-05';

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

async function setup() {
  const auth = fakeAuth();
  const db = dbOf(auth);
  const userId = auth.user?.userId ?? '';
  await ensureSeeds(db, userId);
  await createAccount(
    db,
    userId,
    { name: 'BB', type: 'checking', initialBalanceOn: '2026-10-01' },
    { id: 'bb' },
  );
  const mercado = (await db.categories.where('slug').equals('mercado').first())?.id ?? null;
  const unc = (await db.categories.where('slug').equals('a-classificar').first())?.id ?? null;
  return { auth, db, userId, mercado, unc };
}

function renderScreen(auth: AuthValue, month = '2026-10') {
  const router = createMemoryRouter(
    [{ path: '/planejar/fechar/:mes', element: <CloseMonthScreen today={TODAY} /> }],
    { initialEntries: [`/planejar/fechar/${month}`] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('RN-77: checklist', () => {
  it('US-36: outubro com 2 importados não revisados e 1 em "A classificar" → pendências e botão desativado', async () => {
    const { auth, db, mercado, unc } = await setup();
    await db.transactions.bulkPut([
      tx('i1', {
        account_id: 'bb',
        occurred_on: '2026-10-10',
        source: 'pluggy',
        external_id: 'a',
        review_state: 'new',
        category_id: mercado,
      }),
      tx('i2', {
        account_id: 'bb',
        occurred_on: '2026-10-11',
        source: 'ofx',
        external_id: 'b',
        review_state: 'new',
        category_id: mercado,
      }),
      tx('s1', {
        account_id: 'bb',
        occurred_on: '2026-10-12',
        source: 'pluggy',
        external_id: 'c',
        review_state: 'suggested',
        category_id: mercado,
      }),
      tx('m1', { account_id: 'bb', occurred_on: '2026-10-15', category_id: unc }),
      // novembro não entra
      tx('m2', { account_id: 'bb', occurred_on: '2026-11-02', category_id: unc }),
    ]);
    const list = closingChecklist(await loadHomeRows(db), [], '2026-10', TODAY);
    expect(list).toMatchObject({ suggested: 1, unreviewed: 2, unclassified: 1, openInvoices: [] });
    expect(canClose(list)).toBe(false);
    renderScreen(auth);
    expect(await screen.findByText('Fechar outubro')).toBeDefined();
    expect(screen.getByText('2 importados não revisados').closest('a')?.getAttribute('href')).toBe(
      '/conferir',
    );
    expect(screen.getByText('1 lançamentos para conferir')).toBeDefined();
    expect(
      screen.getByText('1 lançamentos em A classificar').closest('a')?.getAttribute('href'),
    ).toBe('/lancamentos');
    expect(screen.getByTestId('close-run').getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Resolva as pendências para fechar o mês.')).toBeDefined();
  });

  it('RN-77: fatura com vencimento no mês em aberto bloqueia até confirmar o saldo', async () => {
    const { db, userId, mercado } = await setup();
    await db.cards.put(
      makeRow('cards', {
        id: 'nu',
        name: 'Nubank',
        closing_day: 3,
        due_day: 10,
        closing_day_rule: 'next',
        deleted_at: null,
      }),
    );
    await db.invoices.put(
      makeRow('invoices', {
        id: 'inv-out',
        card_id: 'nu',
        reference_month: '2026-10-01',
        closing_date: '2026-10-03',
        due_date: '2026-10-10',
        deleted_at: null,
      }),
    );
    await db.transactions.put(
      tx('c1', {
        card_id: 'nu',
        account_id: null,
        payment_method: 'credit',
        invoice_id: 'inv-out',
        occurred_on: '2026-09-20',
        amount_cents: 98000,
        category_id: mercado,
      }),
    );
    const rows = await loadHomeRows(db);
    const open = closingChecklist(rows, [], '2026-10', TODAY);
    expect(open.openInvoices).toEqual([
      { invoiceId: 'inv-out', cardName: 'Nubank', balanceCents: 98000 },
    ]);
    await confirmOpenInvoice(db, userId, [], '2026-10', 'inv-out');
    const after = closingChecklist(rows, await db.month_closings.toArray(), '2026-10', TODAY);
    expect(after.openInvoices).toEqual([]);
    expect(canClose(after)).toBe(true);
    expect(isMonthClosed(await db.month_closings.toArray(), '2026-10')).toBe(false);
  });
});

describe('US-36: fechar, reabrir e editar mês fechado', () => {
  it('US-36: sem pendência, "Fechar mês" grava o fechamento com snapshot e o evento mes_fechado', async () => {
    const { auth, db, userId, mercado } = await setup();
    await db.transactions.put(
      tx('m1', {
        account_id: 'bb',
        occurred_on: '2026-10-15',
        category_id: mercado,
        amount_cents: 1500,
      }),
    );
    renderScreen(auth);
    expect(await screen.findByText('Nenhuma pendência. O mês pode ser fechado.')).toBeDefined();
    fireEvent.click(screen.getByTestId('close-run'));
    expect(await screen.findByText('Outubro fechado.')).toBeDefined();
    const closing = await db.month_closings.get(monthClosingId(userId, '2026-10'));
    expect(closing?.closed_at).toEqual(expect.any(String));
    expect(closing?.month).toBe('2026-10-01');
    expect(closing?.snapshot).toMatchObject({
      spentCents: 1500,
      availableCents: expect.any(Number),
    });
    const events = ((await db.kv.get(TELEMETRY_KEY))?.value ?? []) as Array<{ code: string }>;
    expect(events.map((e) => e.code)).toContain('usage.mes_fechado');
    expect(await screen.findByTestId('close-closed')).toBeDefined();
    fireEvent.click(screen.getByTestId('close-reopen'));
    await waitFor(async () =>
      expect(
        (await db.month_closings.get(monthClosingId(userId, '2026-10')))?.closed_at,
      ).toBeNull(),
    );
    // a fila de toasts mostra um por vez: confere a tela, não o toast
    expect(await screen.findByTestId('close-checklist')).toBeDefined();
  });

  it('RN-77: fechar de novo refaz o snapshot; reabrir sem fechamento não faz nada', async () => {
    const { db, userId, mercado } = await setup();
    expect((await reopenMonth(db, userId, '2026-10')).ok).toBe(true);
    expect(await db.month_closings.count()).toBe(0);
    await db.transactions.put(
      tx('m1', {
        account_id: 'bb',
        occurred_on: '2026-10-15',
        category_id: mercado,
        amount_cents: 1000,
      }),
    );
    await closeMonth(db, userId, await loadHomeRows(db), [], '2026-10', TODAY);
    await db.transactions.put(
      tx('m2', {
        account_id: 'bb',
        occurred_on: '2026-10-16',
        category_id: mercado,
        amount_cents: 500,
      }),
    );
    await closeMonth(
      db,
      userId,
      await loadHomeRows(db),
      await db.month_closings.toArray(),
      '2026-10',
      TODAY,
    );
    const rows = await db.month_closings.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.snapshot).toMatchObject({ spentCents: 1500 });
  });

  it('US-36: editar um lançamento de outubro pede "Outubro já foi fechado. Salvar mesmo assim?" e reabre o mês', async () => {
    const { auth, db, userId, mercado } = await setup();
    await db.transactions.put(
      tx('t1', {
        account_id: 'bb',
        occurred_on: '2026-10-15',
        category_id: mercado,
        amount_cents: 4590,
      }),
    );
    await closeMonth(db, userId, await loadHomeRows(db), [], '2026-10', TODAY);
    const onClose = vi.fn();
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <QuickEntrySheet onClose={onClose} today={TODAY} editId="t1" />
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
    expect(await screen.findByText('Editar lançamento')).toBeDefined();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('R$\u00a045,90'),
    );
    fireEvent.click(screen.getByTestId('quick-submit'));
    const dialog = await screen.findByTestId('closed-month-dialog');
    expect(dialog.textContent).toContain('Outubro já foi fechado. Salvar mesmo assim?');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Salvar mesmo assim' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(isMonthClosed(await db.month_closings.toArray(), '2026-10')).toBe(false);
  });
});
