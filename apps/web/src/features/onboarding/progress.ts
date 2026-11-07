// Progresso do onboarding (UX §2.3, US-08) em `profiles.onboarding`: passo atual, passos concluídos e pulados,
// início e conclusão (`completedAt` = onboarding_concluido_em do PRD). Fica na conta, então vale offline (Dexie) e
// em outro aparelho depois do sync. Chaves desconhecidas do JSON são mantidas.
import type { LocalRow, OakDb } from '../../data/db';
import { saveRow } from '../../data/repositories/rows';
import { type MessageKey, t } from '../../i18n/pt-BR';

export const ONB_STEPS = ['reminders', 'income', 'accounts', 'cards', 'reserve'] as const;
export type OnbStep = (typeof ONB_STEPS)[number];

export const STEP_PATH: Readonly<Record<OnbStep | 'done', string>> = {
  reminders: '/boas-vindas/lembretes',
  income: '/boas-vindas/renda',
  accounts: '/boas-vindas/contas',
  cards: '/boas-vindas/cartoes',
  reserve: '/boas-vindas/reserva',
  done: '/boas-vindas/pronto',
};

const STEP_NAME: Readonly<Record<OnbStep, MessageKey>> = {
  reminders: 'onb.stepName.reminders',
  income: 'onb.stepName.income',
  accounts: 'onb.stepName.accounts',
  cards: 'onb.stepName.cards',
  reserve: 'onb.stepName.reserve',
};

/** Renda informada no ON05 antes de existir conta ("Cadastrar no próximo passo"): criada no ON06. */
export interface PendingIncome {
  amountCents: number;
  day: number;
}

export interface OnboardingState {
  step?: OnbStep | 'done';
  done: OnbStep[];
  skipped: OnbStep[];
  startedAt?: string;
  completedAt?: string;
  pendingIncome?: PendingIncome;
  variableIncome?: boolean;
  /** Campos de outras versões ou de outras partes do app (instalação, push, seeds). */
  extra: Record<string, unknown>;
}

const KNOWN = new Set([
  'step',
  'done',
  'skipped',
  'startedAt',
  'completedAt',
  'pendingIncome',
  'variableIncome',
]);

function isStep(value: unknown): value is OnbStep {
  return typeof value === 'string' && (ONB_STEPS as readonly string[]).includes(value);
}

function steps(value: unknown): OnbStep[] {
  return Array.isArray(value) ? ONB_STEPS.filter((s) => value.includes(s)) : [];
}

/** Lê o JSON (possivelmente vazio ou de outra versão); nunca lança. */
export function readOnboarding(raw: unknown): OnboardingState {
  const o =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const income = o.pendingIncome as Partial<PendingIncome> | undefined;
  const state: OnboardingState = {
    done: steps(o.done),
    skipped: steps(o.skipped),
    extra: Object.fromEntries(Object.entries(o).filter(([k]) => !KNOWN.has(k))),
  };
  if (isStep(o.step) || o.step === 'done') {
    state.step = o.step;
  }
  if (typeof o.startedAt === 'string') {
    state.startedAt = o.startedAt;
  }
  if (typeof o.completedAt === 'string') {
    state.completedAt = o.completedAt;
  }
  if (
    income &&
    Number.isInteger(income.amountCents) &&
    (income.amountCents ?? 0) > 0 &&
    Number.isInteger(income.day)
  ) {
    state.pendingIncome = { amountCents: income.amountCents as number, day: income.day as number };
  }
  if (typeof o.variableIncome === 'boolean') {
    state.variableIncome = o.variableIncome;
  }
  return state;
}

export function toJson(state: OnboardingState): Record<string, unknown> {
  const { extra, ...known } = state;
  return Object.fromEntries(
    Object.entries({ ...extra, ...known }).filter(([, v]) => v !== undefined),
  );
}

export function stepNumber(step: OnbStep): number {
  return ONB_STEPS.indexOf(step) + 1;
}

/** "Passo 2 de 5 · Renda" (UX §2.3). */
export function stepLabel(step: OnbStep): string {
  return t('onb.step', { n: stepNumber(step), nome: t(STEP_NAME[step]) });
}

export function stepName(step: OnbStep): string {
  return t(STEP_NAME[step]);
}

/** Em andamento: começou e ainda não terminou (a moldura do app leva de volta ao passo, US-08 "Retomar"). */
export function inProgress(state: OnboardingState): state is OnboardingState & { step: OnbStep } {
  return isStep(state.step) && state.completedAt === undefined;
}

/** Ao abrir um passo: ele vira o atual (a retomada volta para ele). Depois da conclusão, nada muda. */
export function enterStep(state: OnboardingState, step: OnbStep, nowIso: string): OnboardingState {
  if (state.completedAt !== undefined || state.step === step) {
    return state;
  }
  return { ...state, step, startedAt: state.startedAt ?? nowIso };
}

function without(list: readonly OnbStep[], step: OnbStep): OnbStep[] {
  return list.filter((s) => s !== step);
}

/** Passo concluído (Continuar): sai dos pulados. */
export function completeStep(state: OnboardingState, step: OnbStep): OnboardingState {
  return {
    ...state,
    done: ONB_STEPS.filter((s) => s === step || state.done.includes(s)),
    skipped: without(state.skipped, step),
  };
}

/** Passo pulado (US-08 "Pular passos"): vira um item do card "Complete a configuração". */
export function skipStep(state: OnboardingState, step: OnbStep): OnboardingState {
  if (state.done.includes(step)) {
    return state;
  }
  return {
    ...state,
    skipped: ONB_STEPS.filter((s) => s === step || state.skipped.includes(s)),
  };
}

/**
 * Para onde ir depois de um passo: no fluxo, o seguinte (o último leva ao ON08); depois da conclusão (vindo do card
 * "Complete a configuração"), o próximo ainda pendente, ou o Início.
 */
export function nextPath(state: OnboardingState, step: OnbStep): string {
  const after = ONB_STEPS.slice(ONB_STEPS.indexOf(step) + 1);
  if (state.completedAt !== undefined) {
    const pending = after.find((s) => state.skipped.includes(s));
    return pending ? STEP_PATH[pending] : '/';
  }
  const next = after[0];
  return next ? STEP_PATH[next] : STEP_PATH.done;
}

/** ON08: grava a conclusão (uma vez; refazer grava de novo). */
export function finish(state: OnboardingState, nowIso: string): OnboardingState {
  if (state.completedAt !== undefined && state.step === 'done') {
    return state;
  }
  return { ...state, step: 'done', completedAt: state.completedAt ?? nowIso };
}

/** "Refazer configuração inicial": reabre o fluxo no ON04 sem apagar nada (os dados já criados ficam). */
export function restart(state: OnboardingState, nowIso: string): OnboardingState {
  const { completedAt: _completed, ...rest } = state;
  return { ...rest, step: 'reminders', done: [], skipped: [], startedAt: nowIso };
}

/** Itens do card "Complete a configuração" (UX §2.3): os passos pulados, na ordem do fluxo. */
export function pendingSteps(state: OnboardingState): OnbStep[] {
  return state.completedAt === undefined ? [] : ONB_STEPS.filter((s) => state.skipped.includes(s));
}

export function pendingText(items: readonly OnbStep[]): string {
  return t('onb.pending.card', {
    itens: items.map((s) => stepName(s).toLocaleLowerCase('pt-BR')).join(', '),
  });
}

export type ProfileRow = LocalRow<'profiles'>;

/** Grava o estado no perfil (a moldura sincroniza depois). Sem perfil local ainda, não faz nada. */
export async function saveOnboarding(
  db: OakDb,
  profile: ProfileRow | null | undefined,
  state: OnboardingState,
): Promise<boolean> {
  if (!profile) {
    return false;
  }
  const result = await saveRow(db, 'profiles', {
    ...profile,
    onboarding: toJson(state) as ProfileRow['onboarding'],
  });
  return result.ok;
}

/** Lê o perfil local, aplica a mudança e grava. Devolve o novo estado. */
export async function updateOnboarding(
  db: OakDb,
  change: (state: OnboardingState) => OnboardingState,
): Promise<OnboardingState> {
  const profile = (await db.profiles.toCollection().first()) ?? null;
  const current = readOnboarding(profile?.onboarding);
  const next = change(current);
  if (next !== current) {
    await saveOnboarding(db, profile, next);
  }
  return next;
}
