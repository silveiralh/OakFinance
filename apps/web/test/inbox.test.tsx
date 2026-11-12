// T-079: I05 Conferir importados (US-49; RN-67, RN-68, RN-73, RN-74).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow, OakDb } from '../src/data/db';
import { APART_KEY, runReconcile } from '../src/data/sync/reconcile-runner';
import {
  decideDifferent,
  decideSame,
  differences,
  inboxCount,
  inboxGroups,
  markAllReviewed,
  unlink,
} from '../src/features/inbox/model';
import { InboxScreen, moneyKindOf } from '../src/features/inbox/screens';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-10';
const NOW = Date.parse('2026-11-10T12:00:00.000Z');
type Row = LocalRow<'transactions'>;

function dbOf(auth: AuthValue): OakDb {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return db;
}

function manual(id: string, cents: number, on: string, extra: Partial<Row> = {}): Row {
  return tx(id, {
    account_id: 'bb',
    payment_method: 'debit',
    amount_cents: cents,
    occurred_on: on,
    source: 'manual',
    review_state: 'ok',
    description: 'Padaria',
    category_id: 'mercado',
    ...extra,
  });
}

function imported(id: string, cents: number, on: string, extra: Partial<Row> = {}): Row {
  return tx(id, {
    account_id: 'bb',
    payment_method: 'debit',
    amount_cents: cents,
    occurred_on: on,
    source: 'pluggy',
    external_id: `ext-${id}`,
    review_state: 'new',
    description: 'PADARIA EXEMPLO',
    category_id: 'mercado',
    server_version: 1,
    client_updated_at: '2026-11-09T12:00:00.000Z',
    ...extra,
  });
}

const CATEGORIES = [
  makeRow('categories', {
    id: 'mercado',
    name: 'Mercado',
    slug: 'mercado',
    kind: 'expense',
    bucket: 'needs',
    deleted_at: null,
    archived_at: null,
    is_system: false,
  }),
  makeRow('categories', {
    id: 'unc',
    name: 'A classificar',
    slug: 'a-classificar',
    kind: 'expense',
    bucket: 'none',
    deleted_at: null,
    archived_at: null,
    is_system: true,
  }),
];

function groupsOf(rows: Row[]) {
  return inboxGroups(rows, { today: TODAY, invoices: [], recurrences: [] });
}

function renderScreen(auth: AuthValue) {
  const router = createMemoryRouter([{ path: '/', element: <InboxScreen today={TODAY} /> }], {
    initialEntries: ['/'],
  });
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
}

describe('I05 — grupos (US-49)', () => {
  it('US-49: três grupos — para decidir com o candidato, novos do banco e vinculados dos últimos 7 dias', () => {
    const rows = [
      manual('L', 5000, '2026-11-05'),
      imported('T', 5150, '2026-11-05', { review_state: 'suggested' }),
      imported('N', 999, '2026-11-08'),
      manual('M', 700, '2026-11-07', { matched_external: true }),
      imported('A', 700, '2026-11-07', { review_state: 'merged', duplicate_of: 'M' }),
      // vinculado há mais de 7 dias: fora
      manual('M2', 800, '2026-10-01', { matched_external: true }),
      imported('A2', 800, '2026-10-01', {
        review_state: 'merged',
        duplicate_of: 'M2',
        client_updated_at: '2026-10-02T00:00:00.000Z',
      }),
      // duplicata entre fontes (merged com outro importado) não aparece como vinculado
      imported('D', 700, '2026-11-07', {
        source: 'ofx',
        review_state: 'merged',
        duplicate_of: 'A',
      }),
    ];
    const groups = groupsOf(rows);
    expect(groups.pending.map((d) => [d.imported.id, d.manual?.id])).toEqual([['T', 'L']]);
    expect(groups.fresh.map((r) => r.id)).toEqual(['N']);
    expect(groups.auto.map((a) => [a.imported.id, a.manual.id])).toEqual([['A', 'M']]);
    // US-49: o ícone mostra a quantidade dos dois primeiros grupos
    expect(inboxCount(groups)).toBe(2);
  });

  it('diferenças com texto (data, valor, meio)', () => {
    expect(
      differences(
        manual('L', 5000, '2026-11-03'),
        imported('T', 5150, '2026-11-04', { payment_method: 'pix' }),
      ),
    ).toEqual([
      'Data diferente: 03/11 × 04/11',
      'Valor diferente: R$\u00a050,00 × R$\u00a051,50',
      'Meio diferente: Débito × Pix',
    ]);
  });
});

describe('I05 — decisões (US-49, RN-68, RN-73, RN-74)', () => {
  it('US-49: "É o mesmo" para R$ 51,50 × R$ 50,00 → o lançamento passa a R$ 51,50, conciliado', async () => {
    const db = dbOf(fakeAuth());
    const L = manual('L', 5000, '2026-11-05');
    const T = imported('T', 5150, '2026-11-05', { review_state: 'suggested' });
    await db.transactions.bulkPut([L, T]);
    expect((await decideSame(db, T, L, NOW)).ok).toBe(true);
    const l = await db.transactions.get('L');
    expect([l?.amount_cents, l?.matched_external, l?.description, l?.category_id]).toEqual([
      5150,
      true,
      'Padaria',
      'mercado',
    ]);
    const t = await db.transactions.get('T');
    expect([t?.review_state, t?.duplicate_of]).toEqual(['merged', 'L']);
    expect((await db.outbox.toArray()).map((e) => e.row_id).sort()).toEqual(['L', 'T']);
  });

  it('US-49: "São diferentes" → lançamento novo a revisar, e o conciliador não sugere o par de novo', async () => {
    const db = dbOf(fakeAuth());
    const T = imported('T', 5150, '2026-11-05', { review_state: 'suggested' });
    await db.transactions.bulkPut([manual('L', 5000, '2026-11-05'), T]);
    await decideDifferent(db, T, NOW);
    expect((await db.transactions.get('T'))?.review_state).toBe('new');
    expect((await db.kv.get(APART_KEY))?.value).toEqual(['T']);
    // o servidor devolve a linha com versão nova: o conciliador não a reavalia
    await db.transactions.update('T', { server_version: 9 });
    expect((await runReconcile(db, { nowMs: NOW })).checked).toBe(0);
    expect((await db.transactions.get('T'))?.review_state).toBe('new');
  });

  it('US-49: revisar em lote — 12 novos ficam revisados; com "A classificar", pede para classificar antes', async () => {
    const db = dbOf(fakeAuth());
    const rows = Array.from({ length: 12 }, (_, i) => imported(`N${i}`, 100 + i, '2026-11-08'));
    await db.transactions.bulkPut(rows);
    const blocked = await markAllReviewed(
      db,
      [...rows, imported('X', 1, '2026-11-08', { category_id: 'unc' })],
      CATEGORIES,
      NOW,
    );
    expect(blocked).toEqual({ kind: 'blocked', unclassified: 1 });
    expect((await db.transactions.get('N0'))?.review_state).toBe('new');
    expect(await markAllReviewed(db, rows, CATEGORIES, NOW)).toEqual({ kind: 'done', n: 12 });
    expect((await db.transactions.toArray()).every((r) => r.review_state === 'ok')).toBe(true);
    // sem categoria também bloqueia (despesa)
    expect(
      await markAllReviewed(
        db,
        [imported('Y', 1, '2026-11-08', { category_id: null })],
        CATEGORIES,
        NOW,
      ),
    ).toEqual({
      kind: 'blocked',
      unclassified: 1,
    });
  });

  it('RN-73: "Não é o mesmo" separa os dois', async () => {
    const db = dbOf(fakeAuth());
    const M = manual('M', 700, '2026-11-07', { matched_external: true });
    const A = imported('A', 700, '2026-11-07', { review_state: 'merged', duplicate_of: 'M' });
    await db.transactions.bulkPut([M, A]);
    await unlink(db, A, M, NOW);
    expect((await db.transactions.get('M'))?.matched_external).toBe(false);
    const a = await db.transactions.get('A');
    expect([a?.review_state, a?.duplicate_of]).toEqual(['new', null]);
  });
});

describe('I05 — tela (US-49)', () => {
  it('US-49: fila vazia → "Nenhum lançamento pendente"', async () => {
    renderScreen(fakeAuth());
    expect(await screen.findByText('Nenhum lançamento pendente')).toBeDefined();
    expect(screen.getByText('Os lançamentos importados já foram conferidos.')).toBeDefined();
  });

  it('US-49: decidir pelo ReconcileCard, dar OK num novo e desfazer um vinculado', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    const notify = vi.spyOn(
      auth.user?.engine as NonNullable<AuthValue['user']>['engine'],
      'notifyWrite',
    );
    await db.categories.bulkPut(CATEGORIES);
    await db.transactions.bulkPut([
      manual('L', 5000, '2026-11-05'),
      imported('T', 5150, '2026-11-05', { review_state: 'suggested' }),
      imported('N', 999, '2026-11-08'),
      manual('M', 700, '2026-11-07', { matched_external: true, description: 'Café' }),
      imported('A', 700, '2026-11-07', { review_state: 'merged', duplicate_of: 'M' }),
    ]);
    renderScreen(auth);
    expect((await screen.findByTestId('inbox-count')).textContent).toBe('2 para conferir');
    const card = screen.getByTestId('reconcile-card');
    expect(within(card).getByText('Lançado por você')).toBeDefined();
    expect(within(card).getByText('Recebido do banco')).toBeDefined();
    expect(within(card).getByText('Valor diferente: R$ 50,00 × R$ 51,50')).toBeDefined();
    fireEvent.click(within(card).getByRole('button', { name: 'É o mesmo' }));
    await waitFor(async () => expect((await db.transactions.get('L'))?.amount_cents).toBe(5150));
    expect(await screen.findByText('Lançamentos vinculados.')).toBeDefined();
    await waitFor(() =>
      expect(screen.getByTestId('inbox-count').textContent).toBe('1 para conferir'),
    );

    const fresh = screen.getByTestId('inbox-fresh-item');
    fireEvent.click(within(fresh).getByRole('button', { name: 'OK' }));
    await waitFor(async () => expect((await db.transactions.get('N'))?.review_state).toBe('ok'));

    fireEvent.click(screen.getByText('Vinculados automaticamente'));
    const auto = screen.getByTestId('inbox-auto');
    // T acabou de ser vinculado e também aparece; o de M é desfeito
    const row = within(auto).getByText('Café').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Não é o mesmo' }));
    await waitFor(async () =>
      expect((await db.transactions.get('M'))?.matched_external).toBe(false),
    );
    expect(notify).toHaveBeenCalled();
  });

  it('US-49: "Marcar todos como revisados" bloqueado por "A classificar" mostra o aviso; Ignorar descarta', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.categories.bulkPut(CATEGORIES);
    await db.transactions.bulkPut([
      imported('N1', 100, '2026-11-08', { category_id: 'unc' }),
      imported('N2', 200, '2026-11-08'),
      imported('S', 300, '2026-11-08', { review_state: 'suggested' }),
    ]);
    renderScreen(auth);
    fireEvent.click(await screen.findByTestId('inbox-review-all'));
    expect((await screen.findByTestId('inbox-blocked')).textContent).toBe(
      'Classifique os 1 lançamentos em "A classificar" antes de marcar todos.',
    );
    // sugestão sem candidato: só "São diferentes" e "Ignorar"
    const card = screen.getByTestId('reconcile-card');
    expect(within(card).getByText('O lançamento parecido não está mais disponível.')).toBeDefined();
    expect(within(card).queryByRole('button', { name: 'É o mesmo' })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Ignorar' }));
    await waitFor(async () =>
      expect((await db.transactions.get('S'))?.review_state).toBe('ignored'),
    );
  });
});

describe('T-116: sinal do valor na conferência (UXC-001)', () => {
  it('RN-74: o sinal vem do tipo — receita e estorno com "+", despesa com "−", transferência sem sinal', () => {
    expect(moneyKindOf('income')).toBe('income');
    expect(moneyKindOf('refund')).toBe('income');
    expect(moneyKindOf('adjust_in')).toBe('income');
    expect(moneyKindOf('expense')).toBe('expense');
    expect(moneyKindOf('adjust_out')).toBe('expense');
    expect(moneyKindOf('transfer')).toBe('transfer');
  });

  it('RN-74: receita importada aparece como entrada em "Novos do banco", não como despesa', async () => {
    const auth = fakeAuth();
    const db = dbOf(auth);
    await db.categories.bulkPut(CATEGORIES);
    await db.transactions.bulkPut([
      imported('IN', 520000, '2026-11-08', { kind: 'income', description: 'SALARIO EXEMPLO' }),
      imported('OUT', 2790, '2026-11-08', { description: 'PADARIA EXEMPLO' }),
    ]);
    renderScreen(auth);
    const income = (await screen.findByText('SALARIO EXEMPLO')).closest('.reconcile-side');
    const expense = screen.getByText('PADARIA EXEMPLO').closest('.reconcile-side');
    const incomeMoney = income?.querySelector('[data-kind]');
    const expenseMoney = expense?.querySelector('[data-kind]');
    expect(incomeMoney?.getAttribute('data-kind')).toBe('income');
    expect(incomeMoney?.textContent).toContain('+R$');
    expect(incomeMoney?.textContent).not.toMatch(/\u2212R\$/);
    expect(expenseMoney?.getAttribute('data-kind')).toBe('expense');
    expect(expenseMoney?.textContent).toMatch(/\u2212R\$/);
  });
});
