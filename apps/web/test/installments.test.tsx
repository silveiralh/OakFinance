import { addMonths, installmentTxId, invoicePeriod } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { resetDrafts } from '../src/data/drafts';
import { cardFromRow } from '../src/data/mappers';
import { createAccount } from '../src/data/repositories/accounts';
import { createCard } from '../src/data/repositories/cards';
import { ensureSeeds } from '../src/data/seeds';
import {
  installmentProblem,
  installmentRows,
  installmentSplit,
  installmentTotal,
} from '../src/features/quick-entry/installments';
import { LAST_METHOD_KEY, QuickEntrySheet } from '../src/features/quick-entry/QuickEntrySheet';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

const TODAY = '2026-11-05';

// o rascunho do Q01 fica também em memória: sem limpar, o valor de um teste vaza para o seguinte (ordem embaralhada)
afterEach(() => resetDrafts());

const CARD_ROW: LocalRow<'cards'> = makeRow('cards', {
  id: 'nu',
  name: 'Nubank',
  closing_day: 3,
  due_day: 10,
  closing_day_rule: 'next',
  limit_cents: null,
  deleted_at: null,
  archived_at: null,
});

describe('installments — compra parcelada (US-20, RN-20..RN-23)', () => {
  it.each([
    ['total R$ 100,00', 10_000, 3, 'total', [3_334, 3_333, 3_333]],
    ['total R$ 1.000,00', 100_000, 10, 'total', Array(10).fill(10_000)],
    ['total R$ 99,99', 9_999, 2, 'total', [5_000, 4_999]],
    ['total R$ 0,10', 10, 3, 'total', [4, 3, 3]],
    ['parcela R$ 49,90', 4_990, 10, 'installment', Array(10).fill(4_990)],
  ] as const)('RN-21: %s em %ix', (_label, amount, n, mode, expected) => {
    expect(installmentSplit(amount, n, mode)).toEqual(expected);
  });

  it('RN-20: no modo parcela, total = parcela × n (R$ 49,90 × 10 = R$ 499,00)', () => {
    expect(installmentTotal(4_990, 10, 'installment')).toBe(49_900);
    expect(installmentTotal(4_990, 10, 'total')).toBe(4_990);
  });

  it('US-20: limites — 1 ou 49 parcelas, ou total menor que o número de parcelas em centavos', () => {
    expect(installmentProblem(10_000, 1, 'total')).toBe('count');
    expect(installmentProblem(10_000, 49, 'total')).toBe('count');
    expect(installmentProblem(2, 3, 'total')).toBe('minTotal');
    expect(installmentProblem(1, 3, 'installment')).toBeNull();
    expect(installmentProblem(10_000, 48, 'total')).toBeNull();
  });

  it('US-20: R$ 1.000,00 em 10x em 05/11/2026 no cartão A (F=3, V=10) → 1/10 em dez/2026 até 10/10 em set/2027', () => {
    const card = cardFromRow(CARD_ROW);
    const base = tx('base', {
      kind: 'expense',
      status: 'posted',
      card_id: 'nu',
      account_id: null,
      payment_method: 'credit',
      description: 'Geladeira',
      category_id: 'cat',
      deleted_at: null,
    });
    const rows = installmentRows({
      seriesId: 'serie',
      userId: 'u',
      card: CARD_ROW,
      invoices: [],
      base,
      amountCents: 100_000,
      count: 10,
      mode: 'total',
      purchaseDate: TODAY,
      nowIso: '2026-11-05T12:00:00.000Z',
    });
    expect(rows.plan).toMatchObject({
      id: 'serie',
      card_id: 'nu',
      installments_count: 10,
      total_cents: 100_000,
      purchase_date: TODAY,
      description: 'Geladeira',
    });
    expect(rows.parcels).toHaveLength(10);
    for (const [i, p] of rows.parcels.entries()) {
      const month = addMonths('2026-12', i);
      expect(p).toMatchObject({
        id: installmentTxId('serie', i + 1),
        series_id: 'serie',
        installment_number: i + 1,
        installment_count: 10,
        amount_cents: 10_000,
        invoice_id: invoicePeriod(card, month).id,
        occurred_on: TODAY,
        status: 'posted',
        description: 'Geladeira',
      });
    }
    expect(rows.invoices.map((i) => i.reference_month)).toEqual(
      Array.from({ length: 10 }, (_, i) => `${addMonths('2026-12', i)}-01`),
    );
    expect(rows.invoices.at(-1)?.reference_month).toBe('2027-09-01');
  });
});

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
  await createCard(
    user.db,
    user.userId,
    { name: 'Nubank', closingDay: 3, dueDay: 10 },
    { id: 'nu' },
  );
  return auth;
}

function mount(auth: ReturnType<typeof fakeAuth>) {
  const onClose = vi.fn();
  const router = createMemoryRouter(
    [{ path: '*', element: <QuickEntrySheet onClose={onClose} today={TODAY} /> }],
    { initialEntries: ['/?novo=despesa'] },
  );
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
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

describe('Q01 parcelado (UX §3 Q01, §5.12)', () => {
  it('US-20: no crédito, 10x mostra a divisão e grava as 10 parcelas; Desfazer apaga a série', async () => {
    const auth = await setup();
    const db = auth.user?.db;
    await db?.kv.put({ key: LAST_METHOD_KEY, value: 'credit:nu' });
    mount(auth);
    const stepper = await screen.findByTestId('quick-installments');
    type('100000');
    fireEvent.click(await screen.findByRole('radio', { name: /Farmácia/ }));
    fireEvent.click(within(stepper).getByRole('radio', { name: '10x' }));
    expect(stepper).toHaveTextContent('10x de R$ 100,00 · primeira parcela em dez/2026');
    fireEvent.click(screen.getByTestId('quick-submit'));
    await waitFor(async () => expect(await db?.transactions.count()).toBe(10));
    const parcels = (await db?.transactions.toArray()) ?? [];
    expect(new Set(parcels.map((p) => p.series_id)).size).toBe(1);
    expect(parcels.map((p) => p.installment_number).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(await db?.installment_plans.count()).toBe(1);
    fireEvent.click(await screen.findByRole('button', { name: 'Desfazer' }));
    await waitFor(async () =>
      expect((await db?.transactions.toArray())?.every((p) => p.deleted_at !== null)).toBe(true),
    );
    expect((await db?.installment_plans.toArray())?.[0]?.deleted_at).not.toBeNull();
  });

  it('US-20: com "Pix · BB" a opção de parcelar não aparece', async () => {
    const auth = await setup();
    await auth.user?.db.kv.put({ key: LAST_METHOD_KEY, value: 'pix:bb' });
    mount(auth);
    await screen.findByTestId('quick-submit');
    expect(screen.queryByTestId('quick-installments')).toBeNull();
  });

  it('US-20: total menor que o número de parcelas mostra a validação e não salva', async () => {
    const auth = await setup();
    const db = auth.user?.db;
    await db?.kv.put({ key: LAST_METHOD_KEY, value: 'credit:nu' });
    mount(auth);
    const stepper = await screen.findByTestId('quick-installments');
    fireEvent.click(within(stepper).getByRole('radio', { name: '3x' }));
    type('2');
    fireEvent.click(await screen.findByRole('radio', { name: /Farmácia/ }));
    expect(
      await screen.findByText('O total precisa ter pelo menos 1 centavo por parcela'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('quick-submit'));
    expect(await db?.transactions.count()).toBe(0);
  });
});
