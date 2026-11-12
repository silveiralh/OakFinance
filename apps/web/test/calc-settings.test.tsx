// T-061: S06 Ajustes do cálculo — US-34 via tela (RN-35, RN-43, RN-46, RN-47).
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { loadHomeRows } from '../src/features/dashboard/data';
import { type HomeRows, homeModel } from '../src/features/dashboard/model';
import { CalcSettingsScreen, percentProblem } from '../src/features/settings/CalcSettingsScreen';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import { base, CATEGORIES, DEC, referenceTxs, rows, seed, TODAY } from './data/reference';
import { makeRow, tx } from './data/rows';

const PROFILE = makeRow('profiles', {
  id: 'perfil',
  settings: {},
  onboarding: {},
  display_name: null,
  timezone: 'America/Sao_Paulo',
  deleted_at: null,
});

async function renderCalc(data: HomeRows): Promise<AuthValue> {
  const auth = fakeAuth();
  await seed(auth, data);
  await auth.user?.db.profiles.put(PROFILE);
  await auth.user?.db.budgets.bulkPut([...data.budgets]);
  const router = createMemoryRouter([{ path: '*', element: <CalcSettingsScreen today={TODAY} /> }]);
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  await screen.findByTestId('calc-preview');
  return auth;
}

const preview = () => screen.getByTestId('calc-preview');

async function saved(auth: AuthValue): Promise<HomeRows> {
  const db = auth.user?.db;
  if (!db) {
    throw new Error('sem sessão');
  }
  return loadHomeRows(db);
}

/** Caso da US-34: referência + compra à vista de R$ 150,00 no cartão A em 15/11 (fatura dez). */
const withCardPurchase = () =>
  rows([
    ...referenceTxs(),
    tx('cartao-15', {
      ...base,
      account_id: null,
      card_id: 'a',
      invoice_id: DEC.id,
      payment_method: 'credit',
      category_id: 'mercado',
      amount_cents: 15000,
      occurred_on: TODAY,
    }),
  ]);

describe('S06 — ajustes do cálculo (US-34)', () => {
  it('US-34: modo competência — o caso de referência passa de R$ 1.210,00 para R$ 2.260,00 e a linha do cartão some', async () => {
    const auth = await renderCalc(withCardPurchase());
    await waitFor(() =>
      expect(preview()).toHaveTextContent('Com estes ajustes: R$ 1.210,00 disponíveis em novembro'),
    );
    // T-125 (UXC-008): a pergunta aparece acima das opções
    expect(screen.getByTestId('calc-card-month-label')).toHaveTextContent(
      'Compras no cartão contam no mês',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'da compra' }));
    expect(preview()).toHaveTextContent('R$ 2.260,00');
    fireEvent.click(screen.getByTestId('calc-save'));
    expect(await screen.findByText('Ajustes salvos.')).toBeInTheDocument();
    const model = homeModel(await saved(auth), TODAY);
    expect(model.config.cardAttribution).toBe('purchase_month');
    expect(model.spendable.availableCents).toBe(226000);
    expect(model.spendable.futureCardCents).toBe(0);
  });

  it('US-34: desligar "Descontar a poupança do mês (20%)" zera o aporte restante → R$ 2.170,00', async () => {
    const auth = await renderCalc(rows(referenceTxs()));
    await waitFor(() => expect(preview()).toHaveTextContent('R$ 1.210,00'));
    fireEvent.click(screen.getByRole('switch', { name: /Descontar a poupança do mês \(20%\)/ }));
    expect(preview()).toHaveTextContent('R$ 2.170,00');
    fireEvent.click(screen.getByTestId('calc-save'));
    await screen.findByText('Ajustes salvos.');
    const model = homeModel(await saved(auth), TODAY);
    expect(model.config.savingsMode).toBe('none');
    expect(model.spendable.savingsReserveCents).toBe(0);
  });

  it('US-34/RN-43: 60/30/20 mostra "Os percentuais somam 110%. Ajuste para totalizar 100%." e não salva', async () => {
    const auth = await renderCalc(rows(referenceTxs()));
    fireEvent.change(screen.getByTestId('calc-pct-needs'), { target: { value: '60' } });
    expect(screen.getByTestId('calc-sum-error')).toHaveTextContent(
      'Os percentuais somam 110%. Ajuste para totalizar 100%.',
    );
    const button = screen.getByTestId('calc-save');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(await auth.user?.db.budgets.count()).toBe(0);
    expect(percentProblem({ needs: 60, wants: 30, savings: 20 })).toBe(110);
    expect(percentProblem({ needs: 50, wants: 30, savings: 20 })).toBeNull();
  });

  it('RN-43: 40/40/20 grava os percentuais e a meta de Necessidades muda', async () => {
    const auth = await renderCalc(rows(referenceTxs()));
    fireEvent.change(screen.getByTestId('calc-pct-needs'), { target: { value: '40' } });
    fireEvent.change(screen.getByTestId('calc-pct-wants'), { target: { value: '40' } });
    expect(screen.queryByTestId('calc-sum-error')).toBeNull();
    fireEvent.click(screen.getByTestId('calc-save'));
    await screen.findByText('Ajustes salvos.');
    const model = homeModel(await saved(auth), TODAY);
    expect(model.buckets.needs.targetCents).toBe(232000);
    expect(model.buckets.wants.targetCents).toBe(232000);
  });

  it('RN-92 (D-082): limiares 80%/120% — Necessidades a 118% deixa de "passar do planejado" e fica em atenção', async () => {
    const auth = await renderCalc(rows(referenceTxs()));
    expect(homeModel(await saved(auth), TODAY).health.needs).toBe('over');
    const attention = screen.getByLabelText('Avisar com atenção a partir de (%)');
    const over = screen.getByLabelText('Avisar que passou do planejado a partir de (%)');
    expect(attention).toHaveValue('80');
    expect(over).toHaveValue('100');
    fireEvent.change(over, { target: { value: '120' } });
    fireEvent.click(screen.getByTestId('calc-save'));
    await screen.findByText('Ajustes salvos.');
    const model = homeModel(await saved(auth), TODAY);
    expect(model.buckets.needs.usageBp).toBe(11827);
    expect(model.health.needs).toBe('attention');
    expect(model.buckets.needs.level).toBe('warning');
  });

  it('RN-92 (D-082): atenção maior que o passou do planejado mostra o erro e não salva', async () => {
    const auth = await renderCalc(rows(referenceTxs()));
    fireEvent.change(screen.getByLabelText('Avisar com atenção a partir de (%)'), {
      target: { value: '120' },
    });
    expect(
      await screen.findByText(
        'Use números inteiros, com a atenção menor que o passou do planejado e no máximo 200.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('calc-save')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('calc-save'));
    const profile = (await saved(auth)).profile;
    expect((profile?.settings as { alerts?: unknown } | undefined)?.alerts).toBeUndefined();
  });

  it('US-34/RN-35: desligar VR/VA — a Base cai R$ 600,00 e os gastos considerados caem R$ 400,00', async () => {
    const vr = makeRow('accounts', {
      id: 'vr',
      name: 'VR',
      type: 'meal_voucher',
      is_restricted: true,
      include_in_spendable: true,
      initial_balance_cents: 0,
      initial_balance_on: '2026-01-01',
      deleted_at: null,
      archived_at: null,
    });
    const beneficios = makeRow('categories', {
      ...(CATEGORIES[0] as LocalRow<'categories'>),
      id: 'beneficios',
      slug: 'beneficios',
      name: 'Benefícios (VR/VA)',
    });
    const data = rows(
      [
        ...referenceTxs(),
        tx('vr-in', {
          ...base,
          kind: 'income',
          account_id: 'vr',
          category_id: 'beneficios',
          amount_cents: 60000,
          occurred_on: '2026-11-02',
          payment_method: 'meal_voucher',
        }),
        tx('vr-out', {
          ...base,
          account_id: 'vr',
          category_id: 'mercado',
          amount_cents: 40000,
          occurred_on: '2026-11-09',
          payment_method: 'meal_voucher',
        }),
      ],
      { categories: [...CATEGORIES, beneficios] },
    );
    const auth = await renderCalc(data);
    await auth.user?.db.accounts.put(vr);
    const before = homeModel(await saved(auth), TODAY).spendable;
    fireEvent.click(screen.getByRole('switch', { name: 'Considerar VR/VA nos cálculos' }));
    fireEvent.click(screen.getByTestId('calc-save'));
    await screen.findByText('Ajustes salvos.');
    const after = homeModel(await saved(auth), TODAY).spendable;
    expect(before.income.totalCents - after.income.totalCents).toBe(60000);
    expect(before.spentCents - after.spentCents).toBe(40000);
  });

  it('US-34: desligar "Descontar faturas e contas que ainda vencem no mês" avisa que deixa de ser conservador', async () => {
    await renderCalc(rows(referenceTxs()));
    await waitFor(() => expect(preview()).toHaveTextContent('R$ 1.210,00'));
    const toggle = screen.getByRole('switch', {
      name: /Descontar faturas e contas que ainda vencem no mês/,
    });
    fireEvent.click(toggle);
    expect(
      screen.getByText('Sem esse desconto, o valor deixa de ser conservador.'),
    ).toBeInTheDocument();
    expect(preview()).toHaveTextContent('R$ 1.490,00');
    expect(
      within(screen.getByTestId('screen-S06')).getByRole('switch', {
        name: /Incluir receitas previstas/,
      }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});
