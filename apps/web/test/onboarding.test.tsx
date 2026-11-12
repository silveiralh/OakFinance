// T-065: onboarding ON04–ON08 (US-08; RN-07, RN-09, RN-32, RN-55) — progresso em profiles.onboarding, Pular,
// retomada, "Refazer configuração inicial" e o card "Complete a configuração".
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/app/App';
import type { AuthValue } from '../src/app/auth';
import { markFreshLogin } from '../src/app/OnboardingGate';
import { appRoutes } from '../src/app/routes';
import { resetDrafts, saveDraft } from '../src/data/drafts';
import { ensureSeeds } from '../src/data/seeds';
import { toggleShortcut } from '../src/features/onboarding/AccountsStep';
import { cardReady, isBlank, previewText } from '../src/features/onboarding/CardsStep';
import {
  completeStep,
  enterStep,
  finish,
  inProgress,
  nextPath,
  pendingSteps,
  pendingText,
  readOnboarding,
  restart,
  skipStep,
  stepLabel,
  toJson,
} from '../src/features/onboarding/progress';
import { suggestionText } from '../src/features/onboarding/ReserveStep';
import { fakeAuth } from './auth-fixture';
import { makeRow } from './data/rows';

const NOW = '2026-11-07T12:00:00.000Z';

afterEach(() => {
  resetDrafts();
  sessionStorage.clear();
});

describe('progresso do onboarding (profiles.onboarding)', () => {
  it('lê JSON vazio, inválido ou de outra versão sem lançar e mantém as chaves desconhecidas', () => {
    expect(readOnboarding({})).toEqual({ done: [], skipped: [], extra: {} });
    expect(readOnboarding(null)).toEqual({ done: [], skipped: [], extra: {} });
    const state = readOnboarding({
      step: 'cards',
      done: ['income', 'x'],
      skipped: 'reminders',
      install: { at: 1 },
      pendingIncome: { amountCents: -1, day: 5 },
    });
    expect(state.step).toBe('cards');
    expect(state.done).toEqual(['income']);
    expect(state.skipped).toEqual([]);
    expect(state.pendingIncome).toBeUndefined();
    expect(toJson(state)).toEqual({
      install: { at: 1 },
      step: 'cards',
      done: ['income'],
      skipped: [],
    });
  });

  it('UX §2.3: stepper "Passo 2 de 5 · Renda"', () => {
    expect(stepLabel('reminders')).toBe('Passo 1 de 5 · Lembretes');
    expect(stepLabel('income')).toBe('Passo 2 de 5 · Renda');
    expect(stepLabel('reserve')).toBe('Passo 5 de 5 · Reserva');
  });

  it('US-08: o fluxo segue os 5 passos e termina no ON08; a conclusão grava completedAt', () => {
    let s = enterStep(readOnboarding({}), 'reminders', NOW);
    expect(inProgress(s)).toBe(true);
    expect(s.startedAt).toBe(NOW);
    expect(nextPath(s, 'reminders')).toBe('/boas-vindas/renda');
    expect(nextPath(s, 'cards')).toBe('/boas-vindas/reserva');
    expect(nextPath(s, 'reserve')).toBe('/boas-vindas/pronto');
    s = finish(completeStep(s, 'reminders'), NOW);
    expect(s).toMatchObject({ step: 'done', completedAt: NOW, done: ['reminders'] });
    expect(inProgress(s)).toBe(false);
    expect(finish(s, '2027-01-01T00:00:00.000Z')).toBe(s);
  });

  it('US-08 "Pular passos": o pulado vira item do card até ser concluído', () => {
    let s = skipStep(skipStep(readOnboarding({ step: 'reminders' }), 'cards'), 'income');
    expect(s.skipped).toEqual(['income', 'cards']);
    expect(pendingSteps(s)).toEqual([]); // antes da conclusão, o card não aparece
    s = finish(s, NOW);
    expect(pendingSteps(s)).toEqual(['income', 'cards']);
    expect(pendingText(pendingSteps(s))).toBe('Complete a configuração: renda, cartões');
    // vindo do card, depois do passo vai ao próximo pendente e, por fim, ao Início
    expect(nextPath(s, 'income')).toBe('/boas-vindas/cartoes');
    s = completeStep(s, 'income');
    expect(nextPath(s, 'cards')).toBe('/');
    s = completeStep(s, 'cards');
    expect(pendingSteps(s)).toEqual([]);
    expect(skipStep(s, 'cards')).toBe(s); // concluído não volta a ficar pendente
    expect(enterStep(s, 'income', NOW)).toBe(s); // depois da conclusão, abrir um passo não muda o atual
  });

  it('US-08 "Refazer depois": reabre no ON04 sem a conclusão, mantendo o resto', () => {
    const s = restart(finish(readOnboarding({ install: 'ok', done: ['income'] }), NOW), NOW);
    expect(s).toMatchObject({ step: 'reminders', done: [], skipped: [], extra: { install: 'ok' } });
    expect(s.completedAt).toBeUndefined();
  });
});

describe('regras dos passos', () => {
  it('RN-07/ON06: atalhos viram linhas na ordem; Pix e débito ficam na primeira conta corrente', () => {
    let d = toggleShortcut({ lines: [], pixFrom: '' }, 'cash');
    expect(d.pixFrom).toBe('');
    d = toggleShortcut(d, 'nubank');
    d = toggleShortcut(d, 'bb');
    expect(d.lines.map((l) => l.shortcut)).toEqual(['bb', 'nubank', 'cash']);
    expect(d.pixFrom).toBe('nubank');
    d = toggleShortcut(d, 'nubank');
    expect(d.pixFrom).toBe('bb');
    expect(d.lines.find((l) => l.shortcut === 'cash')?.name).toBe('Carteira');
  });

  it('RN-09/RN-12: prévia da fatura e formulários de cartão', () => {
    expect(previewText(3, 10, true, '2026-11-15')).toBe(
      'Compras de hoje vão para a fatura de dez/2026, que vence em 10/12/2026',
    );
    expect(previewText(15, 22, true, '2026-11-15')).toBe(
      'Compras de hoje vão para a fatura de dez/2026, que vence em 22/12/2026',
    );
    expect(previewText(15, 22, false, '2026-11-15')).toBe(
      'Compras de hoje vão para a fatura de nov/2026, que vence em 22/11/2026',
    );
    const blank = { name: '', closing: '', due: '', limitCents: 0, toNext: true };
    expect(isBlank(blank)).toBe(true);
    expect(cardReady({ ...blank, name: 'Nubank', closing: '3', due: '10' })).toBe(true);
    expect(cardReady({ ...blank, name: 'Nubank', closing: '32', due: '10' })).toBe(false);
  });

  it('RN-52: meta sugerida provisória, definitiva e sem renda', () => {
    expect(suggestionText(null)).toBe('A meta é sugerida depois que você cadastrar a renda.');
    expect(suggestionText({ targetCents: 1_740_000, provisional: true })).toBe(
      'Meta sugerida: R$\u00A017.400,00 · estimativa provisória, recalculada com seus gastos',
    );
    expect(suggestionText({ targetCents: 1_740_000, provisional: false })).toBe(
      'Meta sugerida: R$\u00A017.400,00',
    );
  });
});

// ------------------------------------------------------------------ telas

async function setup(onboarding: Record<string, unknown> = {}): Promise<AuthValue> {
  const auth = fakeAuth();
  const user = auth.user;
  if (!user) {
    throw new Error('sem sessão');
  }
  await ensureSeeds(user.db, user.userId);
  await user.db.profiles.put(
    makeRow('profiles', {
      id: user.userId,
      user_id: user.userId,
      settings: {},
      onboarding: onboarding as never,
      timezone: 'America/Sao_Paulo',
      deleted_at: null,
    }),
  );
  return auth;
}

function open(auth: AuthValue, path: string) {
  const router = createMemoryRouter(appRoutes(), { initialEntries: [path] });
  render(<App router={router} auth={auth} />);
  return router;
}

const db = (auth: AuthValue) => {
  if (!auth.user) {
    throw new Error('sem sessão');
  }
  return auth.user.db;
};

const onboardingOf = async (auth: AuthValue) =>
  readOnboarding((await db(auth).profiles.toCollection().first())?.onboarding);

const amount = (testId: string, digits: string) =>
  fireEvent.change(within(screen.getByTestId(testId)).getByRole('textbox'), {
    target: { value: digits },
  });

const next = () => fireEvent.click(screen.getByTestId('onb-continue'));

describe('ON04–ON08 (US-08)', () => {
  it('US-08 "Fluxo completo": lembretes, renda, contas, cartão e reserva levam ao ON08 e gravam a conclusão', async () => {
    const auth = await setup();
    const router = open(auth, '/boas-vindas/lembretes');

    // ON04: sem suporte a push no jsdom, "Continuar" grava os tipos escolhidos
    expect(await screen.findByTestId('onb-stepper')).toHaveTextContent('Passo 1 de 5 · Lembretes');
    fireEvent.click(within(screen.getByTestId('onb-notif-weekly')).getByRole('switch'));
    next();

    // ON05: R$ 5.000,00 no dia 5, conta no próximo passo
    expect(await screen.findByTestId('screen-ON05')).toBeInTheDocument();
    expect(screen.getByTestId('onb-stepper')).toHaveTextContent('Passo 2 de 5 · Renda');
    expect(screen.getByTestId('onb-continue')).toHaveAttribute('aria-disabled', 'true');
    amount('onb-income-amount', '500000');
    next();

    // ON06: Banco do Brasil com saldo e Carteira
    expect(await screen.findByTestId('screen-ON06')).toBeInTheDocument();
    expect(
      screen.getByText('Selecione pelo menos uma conta', { selector: 'p' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('onb-account-bb'));
    fireEvent.click(screen.getByTestId('onb-account-cash'));
    amount('onb-line-bb-balance', '123456');
    next();

    // ON07: Nubank fecha dia 3 e vence dia 10
    expect(await screen.findByTestId('screen-ON07')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nome do cartão'), { target: { value: 'Nubank' } });
    fireEvent.change(screen.getByLabelText('Dia de fechamento'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Dia de vencimento'), { target: { value: '10' } });
    expect(screen.getByTestId('onb-card-0-preview')).toHaveTextContent(
      'Compras de hoje vão para a fatura de',
    );
    next();

    // ON07b: R$ 2.000,00 guardados
    expect(await screen.findByTestId('screen-ON07b')).toBeInTheDocument();
    amount('onb-reserve-saved', '200000');
    await waitFor(() =>
      expect(screen.getByTestId('onb-continue')).not.toHaveAttribute('aria-disabled'),
    );
    next();

    expect(await screen.findByTestId('screen-ON08')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Configuração concluída');
    await waitFor(async () => expect((await onboardingOf(auth)).completedAt).toBeDefined());

    const d = db(auth);
    const accounts = await d.accounts.toArray();
    expect(accounts.map((a) => [a.name, a.type, a.initial_balance_cents]).sort()).toEqual([
      ['Banco do Brasil', 'checking', 123_456],
      ['Carteira', 'cash', 0],
    ]);
    const bb = accounts.find((a) => a.name === 'Banco do Brasil');
    const income = (await d.recurrences.toArray()).filter((r) => r.kind === 'income');
    expect(income).toHaveLength(1);
    expect(income[0]).toMatchObject({ amount_cents: 500_000, day_of_month: 5, account_id: bb?.id });
    expect(
      (await d.cards.toArray()).map((c) => [
        c.name,
        c.closing_day,
        c.due_day,
        c.payment_account_id,
      ]),
    ).toEqual([['Nubank', 3, 10, bb?.id]]);
    const goal = (await d.goals.toArray()).find((g) => g.kind === 'emergency_reserve');
    expect(goal?.initial_saved_cents).toBe(200_000);
    const weekly = (await d.reminders.toArray()).find((r) => r.kind === 'weekly_summary');
    expect(weekly?.enabled).toBe(false);
    expect((await d.kv.get('quick.lastMethod'))?.value).toBe(`pix:${bb?.id}`);
    const state = await onboardingOf(auth);
    expect(state.done).toEqual(['reminders', 'income', 'accounts', 'cards', 'reserve']);
    expect(state.pendingIncome).toBeUndefined();

    fireEvent.click(screen.getByTestId('onb-done-home'));
    expect(await screen.findByTestId('screen-H01')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByTestId('onb-pending')).not.toBeInTheDocument();
  });

  it('US-08 "Pular passos": nada é criado e o Início mostra "Complete a configuração"', async () => {
    const auth = await setup();
    open(auth, '/boas-vindas/renda');
    for (const id of ['ON05', 'ON06', 'ON07', 'ON07b']) {
      expect(await screen.findByTestId(`screen-${id}`)).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('onb-skip'));
    }
    expect(await screen.findByTestId('screen-ON08')).toBeInTheDocument();
    const d = db(auth);
    expect(await d.accounts.count()).toBe(0);
    expect(await d.cards.count()).toBe(0);
    expect((await d.recurrences.toArray()).filter((r) => r.kind === 'income')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('onb-done-home'));
    // o card pode aparecer antes de a última gravação (Pular da reserva) chegar à consulta ao vivo
    await waitFor(() =>
      expect(screen.getByTestId('onb-pending')).toHaveTextContent(
        'Complete a configuração: renda, contas, cartões, reserva',
      ),
    );
    fireEvent.click(
      within(screen.getByTestId('onb-pending')).getByRole('button', { name: 'Completar' }),
    );
    expect(await screen.findByTestId('screen-ON05')).toBeInTheDocument();
  });

  it('US-08 "Retomar": fechado no passo 3, volta ao passo 3 com o que já estava preenchido', async () => {
    const auth = await setup({ step: 'accounts', done: ['reminders', 'income'], startedAt: NOW });
    await saveDraft(db(auth), 'onb:accounts', {
      lines: [{ shortcut: 'nubank', name: 'Nubank', balanceCents: 0 }],
      pixFrom: 'nubank',
    });
    const router = open(auth, '/');
    expect(await screen.findByTestId('screen-ON06')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/boas-vindas/contas');
    expect(screen.getByTestId('onb-stepper')).toHaveTextContent('Passo 3 de 5 · Contas');
    await waitFor(() => expect(screen.getByTestId('onb-account-nubank')).toBeChecked());
    expect(screen.getByTestId('onb-line-nubank')).toBeInTheDocument();
  });

  it('US-08: renda informada antes da conta é criada na conta do Pix e débito do ON06', async () => {
    const auth = await setup({
      step: 'accounts',
      pendingIncome: { amountCents: 300_000, day: 31 },
    });
    open(auth, '/boas-vindas/contas');
    fireEvent.click(await screen.findByTestId('onb-account-nubank'));
    next();
    expect(await screen.findByTestId('screen-ON07')).toBeInTheDocument();
    const d = db(auth);
    const nubank = (await d.accounts.toArray())[0];
    await waitFor(async () =>
      expect((await d.recurrences.toArray()).filter((r) => r.kind === 'income')).toMatchObject([
        { amount_cents: 300_000, day_of_month: 31, account_id: nubank?.id },
      ]),
    );
    expect((await onboardingOf(auth)).pendingIncome).toBeUndefined();
  });

  it('ON07: "Não uso cartão de crédito" conclui o passo sem criar cartão nem pendência', async () => {
    const auth = await setup({ step: 'cards' });
    open(auth, '/boas-vindas/cartoes');
    fireEvent.change(await screen.findByLabelText('Dia de fechamento'), {
      target: { value: '40' },
    });
    expect(screen.getByText('Escolha um dia entre 1 e 31.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Dia de fechamento'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Dia de vencimento'), { target: { value: '10' } });
    expect(
      screen.getByText('Fechamento e vencimento no mesmo dia. Confira na sua fatura.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('onb-cards-none'));
    expect(await screen.findByTestId('screen-ON07b')).toBeInTheDocument();
    expect(await db(auth).cards.count()).toBe(0);
    const state = await onboardingOf(auth);
    expect(state.done).toContain('cards');
    expect(state.skipped).not.toContain('cards');
  });

  it('US-08 (UXA-031): ON07 sem placeholder; as sugestões em chips preenchem o nome e "Não uso cartão" é link', async () => {
    const auth = await setup({ step: 'cards' });
    open(auth, '/boas-vindas/cartoes');
    const name = (await screen.findByLabelText('Nome do cartão')) as HTMLInputElement;
    expect(name.placeholder).toBe('');
    const chips = within(screen.getByRole('group', { name: 'Sugestões de nome' }));
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['Nubank', 'Ourocard']);
    fireEvent.click(chips.getByRole('button', { name: 'Ourocard' }));
    expect(name.value).toBe('Ourocard');
    expect(screen.queryByRole('group', { name: 'Sugestões de nome' })).toBeNull();
    expect(screen.getByTestId('onb-cards-none').dataset.variant).toBe('ghost');
    // US-08: "Pular" continua em todos os passos
    expect(screen.getByTestId('onb-skip')).toBeInTheDocument();
  });

  it('US-08 (UXA-029): no ON04 o ícone vem antes do título, como nos outros passos', async () => {
    const auth = await setup();
    open(auth, '/boas-vindas/lembretes');
    const step = await screen.findByTestId('screen-ON04');
    const icon = step.querySelector('.onb-icon');
    const title = within(step).getByRole('heading', { level: 1 });
    expect(icon).not.toBeNull();
    expect(
      (icon as Element).compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('ON07b sem renda: a meta é sugerida depois; "Definir outra meta" grava a meta manual', async () => {
    const auth = await setup({ step: 'reserve' });
    open(auth, '/boas-vindas/reserva');
    expect(
      await screen.findByText('A meta é sugerida depois que você cadastrar a renda.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('onb-reserve-custom'));
    amount('onb-reserve-target', '1000000');
    await waitFor(() =>
      expect(screen.getByTestId('onb-continue')).not.toHaveAttribute('aria-disabled'),
    );
    next();
    expect(await screen.findByTestId('screen-ON08')).toBeInTheDocument();
    const goal = (await db(auth).goals.toArray()).find((g) => g.kind === 'emergency_reserve');
    expect(goal).toMatchObject({
      target_mode: 'manual',
      target_cents: 1_000_000,
      initial_saved_cents: 0,
    });
  });

  it('primeiro login com Google: o perfil sem progresso começa no ON04; quem já usa não é desviado', async () => {
    const existing = await setup();
    open(existing, '/');
    expect(await screen.findByTestId('screen-H01')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId('screen-H01')).toBeInTheDocument();
  });

  it('primeiro login com Google: com a marca do /auth/callback, vai ao ON04', async () => {
    const auth = await setup();
    markFreshLogin();
    const router = open(auth, '/');
    expect(await screen.findByTestId('screen-ON04')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/boas-vindas/lembretes');
    expect(sessionStorage.getItem('oak.onb.fresh')).toBeNull();
  });

  it('US-08 "Refazer depois": Configurações reabre o ON04 sem apagar dados', async () => {
    const auth = await setup({ step: 'done', completedAt: NOW, done: ['income'] });
    await db(auth).accounts.put(
      makeRow('accounts', { id: 'a1', name: 'Nubank', type: 'checking', deleted_at: null }),
    );
    open(auth, '/ajustes');
    fireEvent.click(await screen.findByRole('button', { name: 'Refazer configuração inicial' }));
    expect(await screen.findByTestId('screen-ON04')).toBeInTheDocument();
    const state = await onboardingOf(auth);
    expect(state.step).toBe('reminders');
    expect(state.completedAt).toBeUndefined();
    expect(await db(auth).accounts.count()).toBe(1);
  });
});
