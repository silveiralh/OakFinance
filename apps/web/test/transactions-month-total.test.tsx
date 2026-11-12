// T-122 (D-084 item 2, RN-46): o resumo da T01 soma pelo mês de impacto, como o herói do Início e as faixas da
// P01, para os três baterem com compras no cartão. A linha da compra continua no dia da compra.
import { formatBRL } from '@oakfinance/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext } from '../src/app/auth';
import { budgetView } from '../src/features/budget/budget';
import { homeModel, monthSpent } from '../src/features/dashboard/model';
import { TransactionsScreen } from '../src/features/transactions/TransactionsScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { referenceTxs, rows, seed, TODAY } from './data/reference';

const DATA = rows(referenceTxs());

describe('T-122: total do mês igual na T01, na P01 e no Início', () => {
  it('RN-46: a compra no cartão de outubro (fatura de novembro, paga) conta em novembro nos três', () => {
    const spent = monthSpent(DATA, '2026-11', TODAY);
    const home = homeModel(DATA, TODAY).spendable.spentCents;
    const plan = budgetView(DATA, TODAY);
    const planTotal =
      plan.bands.reduce((sum, band) => sum + band.status.spentCents, 0) +
      plan.unbucketed.spentCents;
    expect(spent.spentCents).toBe(home);
    expect(planTotal).toBe(home);
    // a compra de 1.200,00 no cartão entra em novembro; em outubro (mês da compra) não conta
    expect(home).toBeGreaterThanOrEqual(120_000);
    expect(monthSpent(DATA, '2026-10', TODAY).spentCents).toBe(0);
  });

  it('RN-46 (US-15): na T01 de novembro, Saídas + Guardado é o gasto do Início, com a compra de outubro', async () => {
    const auth = fakeAuth();
    await seed(auth, DATA);
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ToastProvider>
              <TransactionsScreen today={TODAY} />
            </ToastProvider>
          ),
        },
      ],
      { initialEntries: ['/lancamentos'] },
    );
    render(
      <AuthContext.Provider value={auth}>
        <RouterProvider router={router} />
      </AuthContext.Provider>,
    );
    const { spentCents, savingsCents } = monthSpent(DATA, '2026-11', TODAY);
    const summary = await screen.findByTestId('list-summary');
    await waitFor(() =>
      expect(within(summary).getByText('Saídas').nextElementSibling?.textContent).toBe(
        formatBRL(spentCents - savingsCents),
      ),
    );
    expect(within(summary).getByText('Guardado').nextElementSibling?.textContent).toBe(
      formatBRL(savingsCents),
    );
    expect(spentCents).toBe(homeModel(DATA, TODAY).spendable.spentCents);
    // a linha da compra fica no dia dela (outubro), fora da lista de novembro
    expect(screen.queryByTestId('tx-compra-out')).toBeNull();
  });
});
