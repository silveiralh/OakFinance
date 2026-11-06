import {
  bucketBudget,
  invoiceForPurchase,
  invoiceTotals,
  type MonthInput,
} from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { loadDraft, resetDrafts } from '../src/data/drafts';
import { categoryFromRow, txFromRow } from '../src/data/mappers';
import { createAccount } from '../src/data/repositories/accounts';
import { createCard } from '../src/data/repositories/cards';
import { ensureSeeds } from '../src/data/seeds';
import { DRAFT_KEY, transferMissing, usableDraft } from '../src/features/quick-entry/model';
import { QuickEntrySheet } from '../src/features/quick-entry/QuickEntrySheet';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

const TODAY = '2026-11-06';

async function setup() {
  resetDrafts();
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
  await createAccount(
    user.db,
    user.userId,
    { name: 'Carteira', type: 'cash', initialBalanceOn: TODAY },
    { id: 'cart' },
  );
  await createCard(user.db, user.userId, { name: 'A', closingDay: 3, dueDay: 10 }, { id: 'ca' });
  return auth;
}

function mount(auth: ReturnType<typeof fakeAuth>) {
  const onClose = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <ToastProvider>
            <QuickEntrySheet onClose={onClose} today={TODAY} />
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

async function other(label: 'Transferência entre contas' | 'Estorno no cartão') {
  await screen.findByRole('radio', { name: /Mercado/ });
  fireEvent.click(screen.getByTestId('quick-details'));
  fireEvent.click(screen.getByRole('button', { name: label }));
}

function month(
  txs: Parameters<typeof txFromRow>[0][],
  categories: Parameters<typeof categoryFromRow>[0][],
): MonthInput {
  return {
    month: '2026-11',
    today: TODAY,
    txs: txs.map(txFromRow),
    recurrences: [],
    cards: [],
    accounts: [],
    categories: categories.map(categoryFromRow),
    invoiceMonthById: new Map(),
    attribution: 'purchase_month',
    includeRestrictedAccounts: true,
  };
}

const CONFIG = {
  pctBp: { needs: 5000, wants: 3000, savings: 2000 },
  alertThresholdsBp: [8000, 10000],
};

describe('US-16: transferência entre contas', () => {
  it('saque de R$ 200,00 do BB para a Carteira: origem ≠ destino, cartão fora, e o 50/30/20 não muda', async () => {
    const auth = await setup();
    const onClose = mount(auth);
    await other('Transferência entre contas');
    type('20000');
    expect(screen.getAllByText('Escolha a conta de destino').length).toBeGreaterThan(0);
    const destino = screen.getByLabelText('Para') as HTMLSelectElement;
    const options = [...destino.options].map((o) => o.textContent);
    expect(options).not.toContain('BB');
    expect(options).not.toContain('A');
    fireEvent.change(destino, { target: { value: 'cart' } });
    fireEvent.click(screen.getByTestId('quick-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const db = auth.user?.db;
    const [row] = (await db?.transactions.toArray()) ?? [];
    expect(row).toMatchObject({
      kind: 'transfer',
      payment_method: 'transfer',
      account_id: 'bb',
      counterpart_account_id: 'cart',
      amount_cents: 20000,
      card_id: null,
    });
    const categories = (await db?.categories.toArray()) ?? [];
    const before = bucketBudget(month([], categories), CONFIG, 500_000);
    const after = bucketBudget(month(row ? [row] : [], categories), CONFIG, 500_000);
    expect(after).toEqual(before);
    expect(transferMissing(100, 'bb', 'bb')).toBe('Escolha a conta de destino');
    expect(transferMissing(0, 'bb', 'cart')).toBe('Informe o valor');
    expect(transferMissing(100, 'bb', 'cart')).toBeNull();
  });
});

describe('US-22: estorno no cartão', () => {
  it('estorno de R$ 80,00 em Compras e vestuário no cartão A em 06/11/2026 entra na fatura dez/2026 e reduz Desejos', async () => {
    const auth = await setup();
    const onClose = mount(auth);
    await other('Estorno no cartão');
    type('8000');
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    fireEvent.click(await screen.findByText('Compras e vestuário'));
    expect(await screen.findByText('Entra na fatura de dez/2026, vence 10/12')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('quick-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const db = auth.user?.db;
    const [row] = (await db?.transactions.toArray()) ?? [];
    const invoice = invoiceForPurchase(
      {
        id: 'ca',
        closingDay: 3,
        dueDay: 10,
        closingDayRule: 'next',
        limitCents: null,
        paymentAccountId: null,
      },
      TODAY,
    );
    expect(invoice.referenceMonth).toBe('2026-12');
    expect(row).toMatchObject({
      kind: 'refund',
      card_id: 'ca',
      invoice_id: invoice.id,
      amount_cents: 8000,
    });
    if (!row) {
      throw new Error('sem estorno');
    }
    expect(invoiceTotals(invoice.id, [txFromRow(row)]).creditsCents).toBe(8000);
    const categories = (await db?.categories.toArray()) ?? [];
    const compras = categories.find((c) => c.slug === 'compras');
    const purchase = {
      ...row,
      id: 'compra',
      kind: 'expense',
      amount_cents: 20000,
      category_id: compras?.id ?? null,
    };
    const withRefund = bucketBudget(month([purchase, row], categories), CONFIG, 500_000);
    const without = bucketBudget(month([purchase], categories), CONFIG, 500_000);
    expect(without.wants.spentCents - withRefund.wants.spentCents).toBe(8000);
  });
});

describe('G17: rascunho por 24 h (US-64)', () => {
  it('o que foi digitado fica no kv; ao reabrir aparece "Rascunho recuperado." e "Descartar" limpa', async () => {
    const auth = await setup();
    mount(auth);
    await screen.findByRole('radio', { name: /Mercado/ });
    type('3290');
    const db = auth.user?.db;
    if (!db) {
      throw new Error('sem banco');
    }
    await waitFor(async () =>
      expect(await loadDraft(db, DRAFT_KEY)).toMatchObject({ amount: 3290 }),
    );
    document.body.innerHTML = '';
    resetDrafts();
    mount(auth);
    expect(await screen.findByText('Rascunho recuperado.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('R$ 32,90'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('R$ 0,00'),
    );
    expect(await loadDraft(db, DRAFT_KEY)).toBeUndefined();
    expect(usableDraft({ savedAt: 0, amount: 100 }, 25 * 60 * 60 * 1000)).toBeNull();
    expect(usableDraft({ savedAt: 0, amount: 0 }, 1)).toBeNull();
    expect(usableDraft('x', 1)).toBeNull();
  });
});
