// T-061: S06 Ajustes do cálculo — US-34 (cenários Gherkin), RN-35, RN-43, RN-46, RN-47 no nível de componente.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthValue } from '../src/app/auth';
import type { LocalRow } from '../src/data/db';
import { seedBudgetId } from '../src/data/seeds';
import type { HomeRows } from '../src/features/dashboard/model';
import { CalcScreen } from '../src/features/settings/CalcScreen';
import {
  calcDraft,
  calcPreview,
  clampPercent,
  percentSum,
  percentsValid,
  saveCalcSettings,
} from '../src/features/settings/calc';
import { ToastProvider } from '../src/ui';
import { fakeAuth } from './auth-fixture';
import {
  ACCOUNT,
  base,
  CATEGORIES,
  category,
  DEC,
  referenceTxs,
  rows,
  TODAY,
} from './data/reference-case';
import { makeRow, tx } from './data/rows';

/** Compra à vista de R$ 150,00 no cartão A em 15/11 (fatura dez, única compra no cartão em novembro). */
const CARD_150 = tx('cartao-15', {
  ...base,
  account_id: null,
  card_id: 'a',
  invoice_id: DEC.id,
  payment_method: 'credit',
  category_id: 'mercado',
  amount_cents: 15000,
  occurred_on: '2026-11-15',
});

/** RN-35: R$ 600,00 de VR na Base (conta benefício) e R$ 400,00 gastos com a conta VR em novembro. */
const VR = makeRow('accounts', {
  ...ACCOUNT,
  id: 'vr',
  name: 'VR',
  type: 'benefit',
  is_restricted: true,
});
const BENEFITS = { ...category('beneficios', 'income', 'income'), id: 'beneficios' };
const VR_TXS = [
  tx('vr-credito', {
    ...base,
    account_id: 'vr',
    kind: 'income',
    category_id: 'beneficios',
    amount_cents: 60000,
    occurred_on: '2026-11-01',
  }),
  tx('vr-mercado', {
    ...base,
    account_id: 'vr',
    category_id: 'mercado',
    amount_cents: 40000,
    occurred_on: '2026-11-12',
    payment_method: 'debit',
  }),
];

function vrRows(): HomeRows {
  return rows([...referenceTxs(), ...VR_TXS], {
    accounts: [ACCOUNT, VR],
    categories: [...CATEGORIES, BENEFITS],
  });
}

async function seed(auth: AuthValue, data: HomeRows, profile = true) {
  const user = auth.user;
  if (!user) {
    throw new Error('sem sessão');
  }
  await user.db.categories.bulkPut([...data.categories]);
  await user.db.accounts.bulkPut([...data.accounts]);
  await user.db.cards.bulkPut([...data.cards]);
  await user.db.invoices.bulkPut([...data.invoices]);
  await user.db.recurrences.bulkPut([...data.recurrences]);
  await user.db.transactions.bulkPut([...data.txRows]);
  await user.db.budgets.bulkPut([...data.budgets]);
  if (profile) {
    await user.db.profiles.put(
      makeRow('profiles', { id: user.userId, settings: { theme: 'light', hideValues: false } }),
    );
  }
}

async function renderCalc(data: HomeRows, { profile = true } = {}) {
  const auth = fakeAuth();
  await seed(auth, data, profile);
  const router = createMemoryRouter([{ path: '*', element: <CalcScreen today={TODAY} /> }], {
    initialEntries: ['/ajustes/calculo'],
  });
  render(
    <AuthContext.Provider value={auth}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthContext.Provider>,
  );
  await screen.findByTestId('calc-preview-money');
  return auth;
}

const previewMoney = () => screen.getByTestId('calc-preview-money');
const toggle = (testId: string) =>
  fireEvent.click(screen.getByTestId(testId).querySelector('[role="switch"]') as HTMLElement);
const slider = (bucket: string) => screen.getByLabelText(bucketLabel[bucket] ?? bucket);
const bucketLabel: Record<string, string> = {
  needs: 'Necessidades',
  wants: 'Desejos',
  savings: 'Poupança',
};

describe('S06 — modelo (RN-43, RN-47)', () => {
  it('RN-43: percentuais inteiros de 0 a 100 com soma exatamente 100', () => {
    expect(percentsValid({ needs: 50, wants: 30, savings: 20 })).toBe(true);
    expect(percentsValid({ needs: 60, wants: 30, savings: 20 })).toBe(false);
    expect(percentSum({ needs: 60, wants: 30, savings: 20 })).toBe(110);
    expect(percentsValid({ needs: 49.5, wants: 30.5, savings: 20 })).toBe(false);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
  });

  it('US-34: o rascunho começa nos valores salvos e a prévia do caso de referência é R$ 1.210,00', () => {
    const data = rows(referenceTxs());
    const draft = calcDraft(data, TODAY);
    expect(draft.pct).toEqual({ needs: 50, wants: 30, savings: 20 });
    expect(draft.config.cardAttribution).toBe('invoice_due_month');
    expect(calcPreview(data, TODAY, draft).availableCents).toBe(121000);
  });

  it('US-34: modo competência com a compra de R$ 150,00 em 15/11 → R$ 2.260,00, sem "No cartão para os próximos meses"', () => {
    const data = rows([...referenceTxs(), CARD_150]);
    const draft = calcDraft(data, TODAY);
    expect(calcPreview(data, TODAY, draft).availableCents).toBe(121000);
    const competence = calcPreview(data, TODAY, {
      ...draft,
      config: { ...draft.config, cardAttribution: 'purchase_month' },
    });
    expect(competence.availableCents).toBe(226000);
    expect(competence.futureCardCents).toBe(0);
  });

  it('RN-35: desligar VR/VA tira R$ 600,00 da Base e R$ 400,00 dos gastos considerados', () => {
    const data = vrRows();
    const draft = calcDraft(data, TODAY);
    const on = calcPreview(data, TODAY, draft);
    const off = calcPreview(data, TODAY, {
      ...draft,
      config: { ...draft.config, includeRestrictedAccounts: false },
    });
    expect(on.income.totalCents - off.income.totalCents).toBe(60000);
    expect(on.spentCents - off.spentCents).toBe(40000);
  });
});

describe('S06 — Disponível para gastar e orçamento (US-34)', () => {
  it('US-34: Modo competência — trocar "Compras no cartão contam no mês" para "da compra" leva a prévia a R$ 2.260,00', async () => {
    await renderCalc(rows([...referenceTxs(), CARD_150]));
    expect(previewMoney()).toHaveTextContent('R$ 1.210,00');
    expect(
      screen.getByRole('group', { name: 'Compras no cartão contam no mês' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('do vencimento da fatura')).toBeChecked();
    fireEvent.click(screen.getByLabelText('da compra'));
    await waitFor(() => expect(previewMoney()).toHaveTextContent('R$ 2.260,00'));
    expect(screen.getByTestId('calc-preview')).toHaveTextContent(
      'Com estes ajustes: R$ 2.260,00 para gastar em novembro',
    );
  });

  it('US-34: Descontar a poupança do mês — desligar sobe R$ 960,00 (para R$ 2.170,00)', async () => {
    await renderCalc(rows(referenceTxs()));
    expect(screen.getByText('Descontar a poupança do mês (20%)')).toBeInTheDocument();
    toggle('calc-savings');
    await waitFor(() => expect(previewMoney()).toHaveTextContent('R$ 2.170,00'));
  });

  it('US-34: Percentuais inválidos — 60/30/20 mostra "Os percentuais somam 110%…" e não salva', async () => {
    const auth = await renderCalc(rows(referenceTxs()));
    fireEvent.change(slider('needs'), { target: { value: '60' } });
    expect(await screen.findByTestId('calc-sum-error')).toHaveTextContent(
      'Os percentuais somam 110%. Ajuste para totalizar 100%.',
    );
    fireEvent.click(screen.getByTestId('calc-save'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(await auth.user?.db.budgets.count()).toBe(0);
    expect((await auth.user?.db.profiles.toCollection().first())?.settings).toEqual({
      theme: 'light',
      hideValues: false,
    });
    expect(await auth.user?.db.outbox.count()).toBe(0);
  });

  it('US-34: Desligar VR/VA — a prévia sai de R$ 1.290,00 para R$ 1.210,00 (Base − R$ 600,00, gastos − R$ 400,00)', async () => {
    await renderCalc(vrRows());
    expect(previewMoney()).toHaveTextContent('R$ 1.290,00');
    toggle('calc-restricted');
    await waitFor(() => expect(previewMoney()).toHaveTextContent('R$ 1.210,00'));
  });

  it('RN-47: desligar "Descontar faturas e contas que ainda vencem" tira o CP (+ R$ 280,00) e avisa que deixa de ser conservador', async () => {
    await renderCalc(rows(referenceTxs()));
    expect(screen.queryByTestId('calc-upcoming-off')).toBeNull();
    toggle('calc-upcoming');
    await waitFor(() => expect(previewMoney()).toHaveTextContent('R$ 1.490,00'));
    expect(screen.getByTestId('calc-upcoming-off')).toHaveTextContent(
      'Desligado, o valor deixa de ser conservador',
    );
  });

  it('RN-33: desligar "Incluir receitas previstas" tira a receita "Prevista" que conta antes de receber', async () => {
    const expected = tx('freela-prevista', {
      ...base,
      kind: 'income',
      category_id: 'renda-extra',
      amount_cents: 10000,
      occurred_on: '2026-11-28',
      income_expected: true,
      count_before_received: true,
    });
    await renderCalc(rows([...referenceTxs(), expected]));
    // + R$ 100,00 na Base − 20% de poupança = + R$ 80,00
    expect(previewMoney()).toHaveTextContent('R$ 1.290,00');
    toggle('calc-expected');
    await waitFor(() => expect(previewMoney()).toHaveTextContent('R$ 1.210,00'));
  });

  it('RN-43: percentuais novos mudam a poupança da prévia e o rótulo do switch', async () => {
    await renderCalc(rows(referenceTxs()));
    fireEvent.change(slider('wants'), { target: { value: '20' } });
    fireEvent.change(slider('savings'), { target: { value: '30' } });
    expect(screen.queryByTestId('calc-sum-error')).toBeNull();
    expect(screen.getByText('Descontar a poupança do mês (30%)')).toBeInTheDocument();
    // poupança 30% de R$ 5.800,00 = R$ 1.740,00 − R$ 200,00 já guardados = R$ 1.540,00 (antes R$ 960,00)
    await waitFor(() => expect(previewMoney()).toHaveTextContent('R$ 630,00'));
    expect(slider('savings')).toHaveAttribute('aria-valuetext', '30%');
  });

  it('US-34: salvar grava profiles.settings.spendable (mantendo o resto) e os percentuais em budgets, numa transação', async () => {
    const auth = await renderCalc(rows(referenceTxs()));
    const user = auth.user;
    if (!user) {
      throw new Error('sem sessão');
    }
    fireEvent.click(screen.getByLabelText('da compra'));
    toggle('calc-savings');
    fireEvent.change(slider('needs'), { target: { value: '55' } });
    fireEvent.change(slider('wants'), { target: { value: '25' } });
    fireEvent.click(screen.getByTestId('calc-save'));
    expect(await screen.findByText('Ajustes do cálculo salvos.')).toBeInTheDocument();
    const profile = await user.db.profiles.get(user.userId);
    expect(profile?.settings).toEqual({
      theme: 'light',
      hideValues: false,
      spendable: {
        includeExpectedIncome: true,
        savingsMode: 'none',
        includeUpcoming: true,
        cardAttribution: 'purchase_month',
        includeRestrictedAccounts: true,
      },
    });
    const budgets = await user.db.budgets.toArray();
    const pct = Object.fromEntries(budgets.map((b) => [b.bucket, b.pct_bp]));
    // sem linhas locais, as três faixas são gravadas com o id fixo do seed (D-015)
    expect(pct).toEqual({ needs: 5500, wants: 2500, savings: 2000 });
    expect(budgets.every((b) => b.id === seedBudgetId(user.userId, b.bucket ?? ''))).toBe(true);
    expect(budgets.every((b) => b.scope === 'bucket' && b.month === null)).toBe(true);
    expect(await user.db.outbox.count()).toBe(4);
  });

  it('US-34: o valor salvo é o que o painel passa a usar (calcDraft lê de volta)', async () => {
    const auth = fakeAuth();
    const user = auth.user;
    if (!user) {
      throw new Error('sem sessão');
    }
    const data = rows([...referenceTxs(), CARD_150]);
    await seed(auth, data);
    const draft = calcDraft(data, TODAY);
    const result = await saveCalcSettings(
      user.db,
      user.userId,
      { ...draft, config: { ...draft.config, cardAttribution: 'purchase_month' } },
      '2026-11',
    );
    expect(result.ok).toBe(true);
    const stored: HomeRows = {
      ...data,
      budgets: await user.db.budgets.toArray(),
      profile: (await user.db.profiles.toCollection().first()) ?? null,
    };
    const again = calcDraft(stored, TODAY);
    expect(again.config.cardAttribution).toBe('purchase_month');
    expect(calcPreview(stored, TODAY, again).availableCents).toBe(226000);
  });

  it('RN-43: a linha padrão existente é atualizada e o registro do mês, se houver, recebe o mesmo percentual', async () => {
    const auth = fakeAuth();
    const user = auth.user;
    if (!user) {
      throw new Error('sem sessão');
    }
    const budget = (id: string, bucket: string, month: string | null, pct: number) =>
      makeRow('budgets', {
        id,
        scope: 'bucket',
        bucket,
        month,
        category_id: null,
        pct_bp: pct,
        limit_cents: null,
        alert_thresholds_bp: [8000, 10000],
        deleted_at: null,
      }) as LocalRow<'budgets'>;
    const data = rows(referenceTxs(), {
      budgets: [
        budget('padrao-needs', 'needs', null, 5000),
        budget('padrao-wants', 'wants', null, 3000),
        budget('padrao-savings', 'savings', null, 2000),
        budget('nov-savings', 'savings', '2026-11-01', 1000),
      ],
    });
    await seed(auth, data);
    const draft = calcDraft(data, TODAY);
    expect(draft.pct).toEqual({ needs: 50, wants: 30, savings: 10 });
    const result = await saveCalcSettings(
      user.db,
      user.userId,
      { ...draft, pct: { needs: 50, wants: 25, savings: 25 } },
      '2026-11',
    );
    expect(result.ok).toBe(true);
    const byId = Object.fromEntries((await user.db.budgets.toArray()).map((b) => [b.id, b.pct_bp]));
    expect(byId).toEqual({
      'padrao-needs': 5000,
      'padrao-wants': 2500,
      'padrao-savings': 2500,
      'nov-savings': 2500,
    });
  });

  it('sem perfil local, salvar avisa e não grava nada', async () => {
    const auth = await renderCalc(rows(referenceTxs()), { profile: false });
    toggle('calc-savings');
    fireEvent.click(screen.getByTestId('calc-save'));
    expect(await screen.findByTestId('calc-error')).toHaveTextContent(
      'Seu perfil ainda não foi baixado. Conecte-se e tente de novo.',
    );
    expect(await auth.user?.db.outbox.count()).toBe(0);
  });
});
