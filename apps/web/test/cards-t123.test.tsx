// T-123: Cartões (C01/C02) — UXB-010, UXB-011, UXB-012, UXB-013, UXB-021, UXB-025 e D-084 item 10.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { cardFromRow } from '../src/data/mappers';
import { CardsScreen } from '../src/features/cards/CardsScreen';
import { InvoiceScreen } from '../src/features/cards/InvoiceScreen';
import { invoiceView } from '../src/features/cards/model';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const here = dirname(fileURLToPath(import.meta.url));
const shellCss = readFileSync(join(here, '../src/app/shell.css'), 'utf8');

const TODAY = '2026-11-15';

function cardRow(overrides: Partial<LocalRow<'cards'>> = {}): LocalRow<'cards'> {
  return makeRow('cards', {
    id: 'a',
    name: 'Cartão A',
    closing_day: 3,
    due_day: 10,
    closing_day_rule: 'next',
    limit_cents: null,
    deleted_at: null,
    archived_at: null,
    color: null,
    last4: null,
    sort_order: 0,
    ...overrides,
  });
}

const CARD: Card = cardFromRow(cardRow());

function cardTx(
  id: string,
  card: Card,
  month: string,
  cents: number,
  overrides: Partial<LocalRow<'transactions'>> = {},
): LocalRow<'transactions'> {
  const view = invoiceView(card, month as never, [], [], TODAY);
  return tx(id, {
    kind: 'expense',
    status: 'posted',
    amount_cents: cents,
    card_id: card.id,
    account_id: null,
    invoice_id: view.period.id,
    payment_method: 'credit',
    occurred_on: view.period.periodStart,
    review_state: 'ok',
    deleted_at: null,
    series_id: null,
    recurrence_id: null,
    ...overrides,
  });
}

function mount(auth: AuthValue, path: string) {
  const router = createMemoryRouter(
    [
      { path: '/cartoes', element: <CardsScreen today={TODAY} /> },
      { path: '/cartoes/:cartaoId/fatura/:mes', element: <InvoiceScreen today={TODAY} /> },
    ],
    { initialEntries: [path] },
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

async function seeded(
  extra: (db: NonNullable<AuthValue['user']>['db']) => Promise<void> = async () => {},
) {
  const auth = fakeAuth('signedIn');
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem banco');
  }
  await db.cards.put(cardRow());
  await db.accounts.put(
    makeRow('accounts', { id: 'bb', name: 'BB', deleted_at: null, archived_at: null }),
  );
  await extra(db);
  return auth;
}

describe('T-123: C01', () => {
  it('US-18 (UXB-025): com um cartão só, tocar no cartão abre a fatura atual', async () => {
    const auth = await seeded(async (db) => {
      await db.transactions.put(cardTx('c1', CARD, '2026-12', 12_000));
    });
    const router = mount(auth, '/cartoes');
    fireEvent.click(await screen.findByTestId('card-a'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cartoes/a/fatura/2026-12'));
  });

  it('US-18 (UXB-025): com dois cartões, o primeiro toque seleciona e o segundo abre a fatura', async () => {
    const auth = await seeded(async (db) => {
      await db.cards.put(cardRow({ id: 'b', name: 'Cartão B', sort_order: 1 }));
    });
    const router = mount(auth, '/cartoes');
    fireEvent.click(await screen.findByTestId('card-b'));
    await waitFor(() =>
      expect(
        screen.getByTestId('card-b').closest('[aria-roledescription="cartão"]'),
      ).toHaveAttribute('data-selected', 'true'),
    );
    expect(router.state.location.pathname).toBe('/cartoes');
    fireEvent.click(screen.getByTestId('card-b'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/cartoes/b/fatura/2026-12'));
  });

  it('US-18 (UXB-011): o cartão diz qual data é o fechamento e qual o vencimento', async () => {
    mount(await seeded(), '/cartoes');
    expect(await screen.findByTestId('card-a')).toHaveTextContent(
      'Fecha em 03/12 · Vence em 10/12',
    );
  });

  it('UXB-010 e UXB-012 (UX §4.0): cartão sólido, contorno só com mais de um cartão, linhas em 3 colunas', () => {
    expect(shellCss).toMatch(/\.shell \.invoice-card \{\s*background: var\(--surface-dark\);/);
    expect(shellCss).toMatch(/\.shell \.invoice-card::before \{\s*content: none;/);
    expect(shellCss).toMatch(
      /\.cards-carousel:has\(> \.cards-slide \+ \.cards-slide\)\s+\.cards-slide\[data-selected="true"\]\s+\.invoice-card/,
    );
    expect(shellCss).toMatch(
      /\.cards-invoice \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto;/,
    );
    expect(shellCss).toMatch(/\.invoice-pay \{[^}]*position: sticky;/);
  });
});

describe('T-123: C02', () => {
  it('US-19 (UXB-013): na fatura atual com saldo, "Registrar pagamento" é o primário e fica no rodapé', async () => {
    const auth = await seeded(async (db) => {
      await db.transactions.put(cardTx('c1', CARD, '2026-12', 12_000));
    });
    mount(auth, '/cartoes/a/fatura/2026-12');
    const pay = await screen.findByTestId('invoice-pay');
    const button = await screen.findByRole('button', { name: 'Registrar pagamento' });
    expect(pay).toContainElement(button);
    expect(button).toHaveAttribute('data-variant', 'primary');
    // o rodapé vem depois da lista (fixo embaixo pela regra sticky)
    const items = screen.getByTestId('invoice-items');
    expect(items.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('US-19 (UXB-013): numa fatura futura não há primário; o link secundário diz qual fatura paga', async () => {
    const auth = await seeded(async (db) => {
      await db.transactions.put(cardTx('c1', CARD, '2026-12', 12_000));
    });
    mount(auth, '/cartoes/a/fatura/2027-01');
    await screen.findByText('Fatura futura: mostra parcelas e contas fixas já previstas.');
    expect(screen.queryByRole('button', { name: 'Registrar pagamento' })).toBeNull();
    const other = await screen.findByRole('button', { name: 'Pagar a fatura de dez/2026' });
    expect(other).toHaveAttribute('data-variant', 'secondary');
  });

  it('UXB-021: fatura futura também numa linha só ("Fecha em … (n dias) · Vence em …")', async () => {
    mount(await seeded(), '/cartoes/a/fatura/2027-01');
    expect(await screen.findByTestId('invoice-state')).toHaveTextContent(
      /^Fecha em 03\/01 \(\d+ dias\) · Vence em 10\/01$/,
    );
  });
});
