import { type ISODate, invoicePeriod } from '@oakfinance/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow, OakDb } from '../src/data/db';
import { cardFromRow } from '../src/data/mappers';
import { buildPayment } from '../src/features/cards/model';
import {
  cancelRemaining,
  editSeriesFields,
  loadSeries,
  paidLosses,
  reshapeSeries,
} from '../src/features/installments/series';
import { installmentRows, saveInstallmentPurchase } from '../src/features/quick-entry/installments';
import { TransactionDetailScreen } from '../src/features/transactions/TransactionDetailScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { makeRow, tx } from './data/rows';

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
const CARD = cardFromRow(CARD_ROW);
const SERIES = '00000000-0000-7000-8000-00000000a001';

async function purchase(db: OakDb, userId: string, { paidDec = false } = {}) {
  await db.cards.put(CARD_ROW);
  await db.categories.bulkPut([
    makeRow('categories', {
      id: 'casa',
      name: 'Casa',
      kind: 'expense',
      bucket: 'needs',
      is_system: false,
      deleted_at: null,
      archived_at: null,
    }),
    makeRow('categories', {
      id: 'lazer',
      name: 'Lazer',
      kind: 'expense',
      bucket: 'wants',
      is_system: false,
      deleted_at: null,
      archived_at: null,
    }),
  ]);
  const rows = installmentRows({
    seriesId: SERIES,
    userId,
    card: CARD_ROW,
    invoices: [],
    base: tx('base', {
      kind: 'expense',
      status: 'posted',
      card_id: 'nu',
      account_id: null,
      payment_method: 'credit',
      description: 'Geladeira',
      category_id: 'casa',
      deleted_at: null,
    }),
    amountCents: 100_000,
    count: 10,
    mode: 'total',
    purchaseDate: '2026-11-05',
    nowIso: '2026-11-05T12:00:00.000Z',
  });
  await saveInstallmentPurchase(db, rows);
  if (paidDec) {
    await db.transactions.put(
      buildPayment({
        id: 'pag-dez',
        userId,
        cardId: 'nu',
        accountId: 'bb',
        invoice: invoicePeriod(CARD, '2026-12'),
        amountCents: 10_000,
        today: '2026-12-08',
        nowIso: '2026-12-08T12:00:00.000Z',
        categoryId: null,
        description: 'Pagamento',
      }),
    );
  }
  return rows;
}

async function series(db: OakDb) {
  const data = await loadSeries(db, SERIES);
  if (!data) {
    throw new Error('sem série');
  }
  return data;
}

function seeded() {
  const auth = fakeAuth('signedIn');
  const user = auth.user;
  if (!user) {
    throw new Error('sem usuário');
  }
  return { auth, db: user.db, userId: user.userId };
}

describe('installments — editar e cancelar (US-21, RN-24, RN-25)', () => {
  it('US-21: mudar a categoria da parcela 3/10 com "Toda a compra" muda as 10; "Só esta parcela" muda uma', async () => {
    const { db, userId } = seeded();
    const rows = await purchase(db, userId);
    const third = rows.parcels.find((p) => p.installment_number === 3);
    await editSeriesFields(
      db,
      await series(db),
      third?.id ?? '',
      { categoryId: 'lazer' },
      'series',
    );
    const all = await db.transactions.where('series_id').equals(SERIES).toArray();
    expect(all).toHaveLength(10);
    expect(all.every((p) => p.category_id === 'lazer')).toBe(true);
    expect((await db.installment_plans.get(SERIES))?.category_id).toBe('lazer');
    await editSeriesFields(
      db,
      await series(db),
      third?.id ?? '',
      { description: 'Só esta' },
      'one',
    );
    const after = await db.transactions.where('series_id').equals(SERIES).toArray();
    expect(
      after.filter((p) => p.description === 'Só esta').map((p) => p.installment_number),
    ).toEqual([3]);
  });

  it('US-21: sem fatura paga, mudar o total de R$ 1.000,00 para R$ 1.200,00 regenera as 10 parcelas com R$ 120,00 e o mesmo series_id', async () => {
    const { db, userId } = seeded();
    await purchase(db, userId);
    const result = await reshapeSeries(
      db,
      await series(db),
      { totalCents: 120_000, count: 10 },
      '2026-11-15',
    );
    expect(result.ok).toBe(true);
    const all = (await db.transactions.where('series_id').equals(SERIES).toArray()).filter(
      (p) => p.deleted_at === null,
    );
    expect(all).toHaveLength(10);
    expect(all.every((p) => p.amount_cents === 12_000 && p.series_id === SERIES)).toBe(true);
    expect(await db.installment_plans.get(SERIES)).toMatchObject({ total_cents: 120_000 });
    // menos parcelas: as que sobram saem
    await reshapeSeries(db, await series(db), { totalCents: 120_000, count: 6 }, '2026-11-15');
    const six = (await db.transactions.where('series_id').equals(SERIES).toArray()).filter(
      (p) => p.deleted_at === null,
    );
    expect(six.map((p) => p.amount_cents)).toEqual(Array(6).fill(20_000));
  });

  it('US-21: com a parcela 1/10 em fatura paga, mudar o total mostra o texto da RN-24', async () => {
    const { db, userId } = seeded();
    await purchase(db, userId, { paidDec: true });
    const result = await reshapeSeries(
      db,
      await series(db),
      { totalCents: 120_000, count: 10 },
      '2026-12-15',
    );
    expect(result.ok ? null : result.error).toMatchObject({
      code: 'INSTALLMENTS_LOCKED',
      message:
        'Algumas parcelas já estão em faturas pagas. Você pode cancelar as parcelas restantes e lançar o novo valor.',
    });
  });

  it('US-21: hoje 15/01/2027, "Cancelar parcelas restantes" cancela fev..set/2027 e mantém dez/2026 (paga) e jan/2027', async () => {
    const { db, userId } = seeded();
    await purchase(db, userId, { paidDec: true });
    const result = await cancelRemaining(db, await series(db), '2027-01-15');
    expect(result.ok && result.value).toBe(8);
    const all = await db.transactions.where('series_id').equals(SERIES).toArray();
    const status = new Map(all.map((p) => [p.installment_number, p.status]));
    expect([status.get(1), status.get(2)]).toEqual(['posted', 'posted']);
    expect([3, 4, 5, 6, 7, 8, 9, 10].map((n) => status.get(n))).toEqual(Array(8).fill('cancelled'));
  });

  it('US-21: "Apagar a compra inteira" com fatura paga avisa o valor que a fatura de dez/2026 deixa de mostrar', async () => {
    const { db, userId } = seeded();
    await purchase(db, userId, { paidDec: true });
    expect(paidLosses(await series(db), '2026-12-15' as ISODate)).toEqual([
      { month: '2026-12', amountCents: 10_000 },
    ]);
  });
});

function mount(auth: AuthValue, id: string, today: string) {
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

describe('T02 da parcela (UX §3 T02)', () => {
  it('US-14: Excluir abre as opções da RN-25 e "Apagar a compra inteira" pede a segunda confirmação com a fatura paga', async () => {
    const { auth, db, userId } = seeded();
    const rows = await purchase(db, userId, { paidDec: true });
    const first = rows.parcels[0];
    const router = mount(auth, first?.id ?? '', '2026-12-15');
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    const dialog = await screen.findByTestId('series-delete');
    expect(dialog).toHaveTextContent('Compra em 10x. O que deseja fazer?');
    // o <dialog> entra no DOM antes do showModal(): espera os botões ficarem acessíveis
    expect(
      await within(dialog).findByRole('button', { name: 'Cancelar parcelas restantes' }),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apagar a compra inteira' }));
    const warning = await screen.findByTestId('series-paid-warning');
    expect(warning).toHaveTextContent(
      'A fatura de dez/2026, já paga, vai deixar de mostrar R$ 100,00.',
    );
    fireEvent.click(await within(warning).findByRole('button', { name: 'Apagar mesmo assim' }));
    await waitFor(async () =>
      expect(
        (await db.transactions.where('series_id').equals(SERIES).toArray()).every(
          (p) => p.deleted_at !== null,
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/lancamentos'));
  });

  it('US-21: a folha de edição muda a categoria da compra toda e recusa o total com fatura paga', async () => {
    const { auth, db, userId } = seeded();
    const rows = await purchase(db, userId, { paidDec: true });
    mount(auth, rows.parcels[2]?.id ?? '', '2026-12-15');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const sheet = await screen.findByTestId('series-sheet');
    fireEvent.change(within(sheet).getByLabelText('Categoria'), { target: { value: 'lazer' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(async () =>
      expect(
        (await db.transactions.where('series_id').equals(SERIES).toArray()).every(
          (p) => p.category_id === 'lazer',
        ),
      ).toBe(true),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    const again = await screen.findByTestId('series-sheet');
    fireEvent.change(within(again).getByLabelText('Número de parcelas'), {
      target: { value: '12' },
    });
    fireEvent.click(within(again).getByRole('button', { name: 'Salvar alterações' }));
    expect(await within(again).findByRole('alert')).toHaveTextContent(
      'Algumas parcelas já estão em faturas pagas.',
    );
  });
});
