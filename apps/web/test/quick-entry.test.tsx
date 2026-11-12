import { invoiceForPurchase } from '@oakfinance/domain';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { resetDrafts } from '../src/data/drafts';
import { createAccount } from '../src/data/repositories/accounts';
import { createCard } from '../src/data/repositories/cards';
import { ensureSeeds } from '../src/data/seeds';
import {
  markQuickEntryStart,
  quickEntryElapsed,
  resetQuickEntryClock,
} from '../src/features/quick-entry/clock';
import { categoryIcon } from '../src/features/quick-entry/icons';
import { buildMethods, missingReason, suggestCategories } from '../src/features/quick-entry/model';
import {
  FabMenu,
  QuickEntryHost,
  withoutQuickEntry,
} from '../src/features/quick-entry/QuickEntryHost';
import { LAST_METHOD_KEY, QuickEntrySheet } from '../src/features/quick-entry/QuickEntrySheet';
import { TELEMETRY_KEY } from '../src/lib/telemetry';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-05';

afterEach(() => {
  resetQuickEntryClock();
});

async function setup({ card = false } = {}) {
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
  if (card) {
    await createCard(
      user.db,
      user.userId,
      { name: 'Nubank', closingDay: 3, dueDay: 10 },
      { id: 'nu' },
    );
  }
  await user.db.outbox.clear();
  return auth;
}

function mount(auth: ReturnType<typeof fakeAuth>, onClose = vi.fn()) {
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
    { initialEntries: ['/?novo=despesa'] },
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

describe('Q01 modelo (US-12)', () => {
  it('US-12: sem histórico, as 5 sugestões são Mercado, Restaurantes e delivery, Transporte, Combustível e Farmácia', async () => {
    const auth = await setup();
    const categories = (await auth.user?.db.categories.toArray()) ?? [];
    expect(suggestCategories(categories, [], TODAY).map((c) => c.name)).toEqual([
      'Mercado',
      'Restaurantes e delivery',
      'Transporte',
      'Combustível',
      'Farmácia',
    ]);
    const lazer = categories.find((c) => c.slug === 'lazer');
    const recent = [
      tx('a', { category_id: lazer?.id ?? null, occurred_on: '2026-11-01' }),
      tx('b', { category_id: lazer?.id ?? null, occurred_on: '2026-10-20' }),
      tx('c', { category_id: lazer?.id ?? null, occurred_on: '2026-09-01' }),
    ];
    const frequent = suggestCategories(categories, recent, TODAY).map((c) => c.name);
    expect(frequent[0]).toBe('Lazer');
    expect(frequent).toHaveLength(5);
  });

  it('meios: Pix e Débito por conta corrente, Dinheiro, VR, VA e Crédito por cartão', () => {
    const accounts = [
      makeRow('accounts', { id: 'bb', name: 'BB', type: 'checking' }),
      makeRow('accounts', { id: 'cart', name: 'Carteira', type: 'cash' }),
      makeRow('accounts', { id: 'vr', name: 'VR', type: 'meal_voucher' }),
      makeRow('accounts', { id: 'va', name: 'VA', type: 'food_voucher' }),
      makeRow('accounts', {
        id: 'old',
        name: 'Velha',
        type: 'checking',
        archived_at: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const cards = [makeRow('cards', { id: 'nu', name: 'Nubank' })];
    expect(buildMethods(accounts, cards).map((m) => [m.label, m.paymentMethod])).toEqual([
      ['Pix · BB', 'pix'],
      ['Débito · BB', 'debit'],
      ['Carteira', 'cash'],
      ['VR', 'meal_voucher'],
      ['VA', 'food_voucher'],
      ['Crédito · Nubank', 'credit'],
    ]);
  });

  it('US-12: valor zero ou sem categoria dizem o que falta', () => {
    expect(missingReason(0, 'x')).toBe('Informe o valor');
    expect(missingReason(100, null)).toBe('Escolha a categoria');
    expect(missingReason(100, 'x')).toBeNull();
  });

  it('relógio do lançamento e ícones', () => {
    expect(quickEntryElapsed(10)).toBeNull();
    markQuickEntryStart(100);
    expect(quickEntryElapsed(1_350)).toBe(1_250);
    expect(categoryIcon('ShoppingCart')).not.toBe(categoryIcon(null));
    expect(withoutQuickEntry('/cartoes', '?mes=1&novo=despesa')).toBe('/cartoes?mes=1');
    expect(withoutQuickEntry('/', '?novo=despesa')).toBe('/');
  });
});

describe('Q01 tela (US-12, US-17)', () => {
  it('US-12: 4590 → R$ 45,90, "Mercado", "Lançar": despesa efetivada de hoje no último meio, toast com Desfazer e evento', async () => {
    const auth = await setup();
    const onClose = mount(auth);
    const submit = await screen.findByTestId('quick-submit');
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByText('Informe o valor').length).toBeGreaterThan(0);
    type('4590');
    expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('R$\u00A045,90');
    expect(screen.getAllByText('Escolha a categoria').length).toBeGreaterThan(0);
    markQuickEntryStart(performance.now() - 2_000);
    fireEvent.click(await screen.findByRole('radio', { name: /Mercado/ }));
    await waitFor(() =>
      expect(screen.getByTestId('quick-submit')).not.toHaveAttribute('aria-disabled'),
    );
    fireEvent.click(screen.getByTestId('quick-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const db = auth.user?.db;
    const [saved] = (await db?.transactions.toArray()) ?? [];
    expect(saved).toMatchObject({
      kind: 'expense',
      status: 'posted',
      amount_cents: 4590,
      occurred_on: TODAY,
      payment_method: 'pix',
      account_id: 'bb',
      source: 'manual',
      _pending: 1,
    });
    expect((await db?.kv.get(LAST_METHOD_KEY))?.value).toBe('pix:bb');
    expect(screen.getByText('Lançamento salvo.')).toBeInTheDocument();
    const events = ((await db?.kv.get(TELEMETRY_KEY))?.value ?? []) as Array<{
      code: string;
      context: Record<string, unknown>;
    }>;
    const event = events.find((e) => e.code === 'usage.lancamento_salvo');
    expect(event?.context).toMatchObject({ offline: false, origem: 'manual' });
    expect(Number(event?.context.duracao_ms)).toBeGreaterThanOrEqual(2_000);
    expect(JSON.stringify(events)).not.toContain('4590');
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    await waitFor(async () =>
      expect((await db?.transactions.get(saved?.id ?? ''))?.deleted_at).not.toBeNull(),
    );
  });

  it('US-17: no crédito, mostra "Entra na fatura de dez/2026, vence 10/12" e grava a fatura v5', async () => {
    const auth = await setup({ card: true });
    await auth.user?.db.kv.put({ key: LAST_METHOD_KEY, value: 'credit:nu' });
    mount(auth);
    expect(await screen.findByText('Entra na fatura de dez/2026, vence 10/12')).toBeInTheDocument();
    type('12000');
    fireEvent.click(await screen.findByRole('radio', { name: /Farmácia/ }));
    fireEvent.click(screen.getByTestId('quick-submit'));
    const db = auth.user?.db;
    await waitFor(async () => expect(await db?.transactions.count()).toBe(1));
    const [saved] = (await db?.transactions.toArray()) ?? [];
    const expected = invoiceForPurchase(
      {
        id: 'nu',
        closingDay: 3,
        dueDay: 10,
        closingDayRule: 'next',
        limitCents: null,
        paymentAccountId: null,
      },
      TODAY,
    );
    expect(saved).toMatchObject({
      payment_method: 'credit',
      card_id: 'nu',
      account_id: null,
      invoice_id: expected.id,
    });
    expect(await db?.invoices.get(expected.id)).toMatchObject({
      reference_month: '2026-12-01',
      closing_date: '2026-12-03',
      due_date: '2026-12-10',
    });
  });

  it('"Mais" abre o seletor com todas as categorias de despesa', async () => {
    const auth = await setup();
    mount(auth);
    fireEvent.click(await screen.findByRole('button', { name: 'Mais' }));
    expect(await screen.findByText('Moradia')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Moradia'));
    await waitFor(() => expect(screen.getByRole('radio', { name: /Moradia/ })).toBeChecked());
  });

  it('host abre o Q01 com ?novo=despesa (e não com um modo desconhecido); menu do toque longo tem Receita, Guardar, Importar extrato e Ler nota', async () => {
    const auth = await setup();
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <QuickEntryHost />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: ['/lancamentos?novo=outro'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    expect(screen.queryByTestId('quick-entry')).not.toBeInTheDocument();
    await act(() => router.navigate('/lancamentos?novo=despesa'));
    expect(await screen.findByTestId('quick-entry')).toBeInTheDocument();
    const onPick = vi.fn();
    render(<FabMenu open onClose={vi.fn()} onPick={onPick} />);
    // T-126: o Q01 aberto também tem "Ler nota" (D-096); o menu é conferido dentro dele
    const menu = within(screen.getByTestId('fab-menu'));
    // D-076 (T-118): o toque simples já abre a despesa; o menu traz Receita, Guardar, Importar extrato e Ler nota
    for (const label of ['Receita', 'Guardar', 'Importar extrato', 'Ler nota']) {
      expect(menu.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(menu.queryByRole('button', { name: 'Despesa' })).toBeNull();
    fireEvent.click(menu.getByRole('button', { name: 'Ler nota' }));
    expect(onPick).toHaveBeenCalledWith('/nota');
    fireEvent.click(menu.getByRole('button', { name: 'Importar extrato' }));
    expect(onPick).toHaveBeenCalledWith('/importar');
  });
});

describe('T-126: "Ler nota" no Q01 (D-096)', () => {
  it('US-54 (D-096): o Q01 de despesa mostra "Ler nota", que leva à I04; na receita some', async () => {
    const auth = fakeAuth('signedIn');
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <QuickEntrySheet onClose={vi.fn()} today={TODAY} />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: ['/?novo=despesa'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const button = await screen.findByTestId('quick-read-note');
    expect(button).toHaveTextContent('Ler nota');
    fireEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe('/nota'));
  });
});

describe('issue #71: Q01 sem conta nem cartão', () => {
  // o rascunho do Q01 fica em memória: sem limpar, o valor digitado aqui vaza para o próximo teste
  afterEach(() => resetDrafts());

  it('US-12: sem forma de pagamento, "Lançar" diz "Cadastre uma conta ou um cartão primeiro" e oferece Adicionar conta', async () => {
    const auth = fakeAuth('signedIn');
    const user = auth.user;
    if (!user) {
      throw new Error('sem usuário');
    }
    await ensureSeeds(user.db, user.userId);
    expect(missingReason(100, 'cat', false)).toBe('Cadastre uma conta ou um cartão primeiro');
    expect(missingReason(0, 'cat', false)).toBe('Informe o valor');
    mount(auth);
    type('1000');
    fireEvent.click(await screen.findByRole('radio', { name: /Farmácia/ }));
    const submit = screen.getByTestId('quick-submit');
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Cadastre uma conta ou um cartão primeiro')).toBeInTheDocument();
    expect(screen.getByTestId('quick-add-account')).toHaveTextContent('Adicionar conta');
    fireEvent.click(submit);
    expect(await user.db.transactions.count()).toBe(0);
  });
});
