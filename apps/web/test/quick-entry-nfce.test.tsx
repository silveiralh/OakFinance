// T-089: Q01 pré-preenchido pela nota (UX §3 Q01 e I04; US-54, RN-84): selo "Dados da nota fiscal", valor, data e
// loja vindos da nota; o lançamento salvo fica ligado à nota (`source = 'nfce'`).
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { createAccount } from '../src/data/repositories/accounts';
import { ensureSeeds } from '../src/data/seeds';
import { type QuickEntryNfce, QuickEntrySheet } from '../src/features/quick-entry/QuickEntrySheet';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';

const TODAY = '2026-11-06';

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
  return auth;
}

function mount(auth: ReturnType<typeof fakeAuth>, nfce: QuickEntryNfce) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <ToastProvider>
            <QuickEntrySheet onClose={vi.fn()} today={TODAY} nfce={nfce} />
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
}

describe('US-54: Q01 pela nota', () => {
  it('US-54: nota completa abre o Q01 com selo, valor, data e loja; salvo fica ligado à nota', async () => {
    const auth = await setup();
    mount(auth, {
      receiptId: 'nota-1',
      issuerCnpj: '12345678000100',
      issuerName: 'SUPERMERCADO EXEMPLO',
      draft: { description: 'SUPERMERCADO EXEMPLO', occurredOn: '2026-11-05', amountCents: 18745 },
    });
    expect(await screen.findByText('Dados da nota fiscal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('SUPERMERCADO EXEMPLO')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('R$ 187,45');
    fireEvent.click(await screen.findByRole('radio', { name: /Mercado/ }));
    fireEvent.click(screen.getByTestId('quick-submit'));
    await waitFor(async () => expect(await auth.user?.db.transactions.count()).toBe(1));
    const saved = (await auth.user?.db.transactions.toArray())?.[0];
    expect(saved).toMatchObject({
      source: 'nfce',
      nfce_receipt_id: 'nota-1',
      merchant_cnpj: '12345678000100',
      merchant_name: 'SUPERMERCADO EXEMPLO',
      amount_cents: 18745,
      occurred_on: '2026-11-05',
      description: 'SUPERMERCADO EXEMPLO',
    });
  });

  it('RN-84: fallback abre com o CNPJ como descrição e o valor em branco', async () => {
    const auth = await setup();
    mount(auth, {
      receiptId: 'nota-2',
      issuerCnpj: '12345678000100',
      issuerName: null,
      draft: { description: '12.345.678/0001-00', occurredOn: TODAY, amountCents: null },
    });
    expect(await screen.findByText('Dados da nota fiscal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12.345.678/0001-00')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Valor' })).toHaveValue('R$ 0,00');
  });
});
