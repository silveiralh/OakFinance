// Moldura dos passos ON04–ON07b (UX §2.3): "Passo n de 5 · {nome}" com a barra fina, título, conteúdo e o rodapé
// com a ação principal e "Pular". O hook `useOnbStep` grava o passo atual (retomada) e avança.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { clearDraft, loadDraft, saveDraft } from '../../data/drafts';
import { type ScreenId, t } from '../../i18n/pt-BR';
import { Button, ProgressBar } from '../../ui';
import {
  completeStep,
  enterStep,
  nextPath,
  type OnboardingState,
  type OnbStep,
  skipStep,
  stepLabel,
  stepNumber,
  updateOnboarding,
} from './progress';

export const STEP_SCREEN: Readonly<Record<OnbStep, ScreenId>> = {
  reminders: 'ON04',
  income: 'ON05',
  accounts: 'ON06',
  cards: 'ON07',
  reserve: 'ON07b',
};

const draftKey = (step: OnbStep) => `onb:${step}`;

export interface OnbFrameProps {
  step: OnbStep;
  title: string;
  children: ReactNode;
  /** Ação principal (Continuar, Ativar lembretes…). */
  primary: ReactNode;
  /** Link secundário além do Pular (ex.: "Não uso cartão de crédito"). */
  secondary?: ReactNode;
  onSkip: () => void;
  skipLabel?: string;
}

export function OnbFrame({
  step,
  title,
  children,
  primary,
  secondary,
  onSkip,
  skipLabel,
}: OnbFrameProps) {
  const screen = STEP_SCREEN[step];
  const label = stepLabel(step);
  return (
    <section className="screen onb-step" data-screen={screen} data-testid={`screen-${screen}`}>
      <header className="onb-stepper">
        <p className="onb-stepper-label" data-testid="onb-stepper">
          {label}
        </p>
        <ProgressBar
          valueCents={stepNumber(step)}
          maxCents={5}
          size="xs"
          tone="info"
          label={label}
        />
      </header>
      <h1 className="screen-title">{title}</h1>
      <div className="onb-body">{children}</div>
      <footer className="onb-actions">
        {primary}
        {secondary}
        <Button variant="ghost" fullWidth onClick={onSkip} data-testid="onb-skip">
          {skipLabel ?? t('common.skip')}
        </Button>
      </footer>
    </section>
  );
}

/** Passo atual do onboarding: grava a entrada (para a retomada) e oferece Continuar/Pular. */
export function useOnbStep(step: OnbStep) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }
    void updateOnboarding(user.db, (s) => enterStep(s, step, new Date().toISOString())).then(() =>
      user.engine.notifyWrite(),
    );
  }, [user, step]);

  const advance = async (
    how: 'done' | 'skip',
    change: (s: OnboardingState) => OnboardingState = (s) => s,
  ) => {
    if (!user) {
      void navigate('/');
      return;
    }
    setBusy(true);
    try {
      const next = await updateOnboarding(user.db, (s) =>
        how === 'done' ? completeStep(change(s), step) : skipStep(change(s), step),
      );
      await clearDraft(user.db, draftKey(step));
      user.engine.notifyWrite();
      void navigate(nextPath(next, step));
    } finally {
      setBusy(false);
    }
  };
  return { user, busy, advance };
}

/** O que já foi digitado no passo fica no aparelho e volta ao reabrir (US-08 "Retomar"). */
export function useStepDraft<T>(step: OnbStep, initial: T): [T, (value: T) => void, boolean] {
  const { user } = useAuth();
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(!user);
  const touched = useRef(false);

  useEffect(() => {
    if (!user) {
      return;
    }
    let alive = true;
    void loadDraft(user.db, draftKey(step)).then((saved) => {
      if (alive) {
        if (saved !== undefined && !touched.current) {
          setValue(saved as T);
        }
        setLoaded(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [user, step]);

  const update = (next: T) => {
    touched.current = true;
    setValue(next);
    if (user) {
      void saveDraft(user.db, draftKey(step), next);
    }
  };
  return [value, update, loaded];
}
