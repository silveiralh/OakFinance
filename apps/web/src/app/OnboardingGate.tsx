// Encaminha ao onboarding (UX §2.3, US-08): com o fluxo em andamento em `profiles.onboarding`, volta ao passo onde
// parou (também offline, pelo Dexie, e em outro aparelho depois do sync); no primeiro login com Google, começa no
// ON04 (no Android fora do app instalado, antes passa pelo ON02a). Quem já usa o app (perfil sem progresso e sem
// login novo) não é desviado.
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useLive } from '../data/live';
import { inProgress, readOnboarding, STEP_PATH } from '../features/onboarding/progress';
import { installTarget, isStandalone, readInstallChoices, wasInstalled } from '../lib/platform';
import { useAuth } from './auth';

const FRESH_LOGIN_KEY = 'oak.onb.fresh';

/** Marcado pelo `/auth/callback`: o próximo perfil carregado decide se o onboarding começa. */
export function markFreshLogin(storage: Pick<Storage, 'setItem'> | undefined = session()): void {
  try {
    storage?.setItem(FRESH_LOGIN_KEY, '1');
  } catch {
    // sem armazenamento: o onboarding ainda abre pelo card ou pelos Ajustes
  }
}

function session(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

function takeFreshLogin(): boolean {
  const storage = session();
  try {
    const fresh = storage?.getItem(FRESH_LOGIN_KEY) === '1';
    storage?.removeItem(FRESH_LOGIN_KEY);
    return fresh;
  } catch {
    return false;
  }
}

/** Primeira tela do fluxo depois do login (UX §2.3): ON02a no Android pelo navegador, senão ON04. */
export function firstOnboardingPath(): string {
  const android = installTarget(navigator) === 'android';
  const choices = readInstallChoices();
  if (android && !isStandalone(navigator) && !wasInstalled() && choices.dismissedAt === null) {
    return '/instalar?p=android';
  }
  return STEP_PATH.reminders;
}

export function OnboardingGate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const profile = useLive(
    user ? async () => (await user.db.profiles.toCollection().first()) ?? null : null,
    [user],
  );
  const raw = profile?.onboarding;
  const ready = profile !== undefined && profile !== null;

  useEffect(() => {
    if (!ready) {
      return;
    }
    const state = readOnboarding(raw);
    const fresh = takeFreshLogin();
    if (inProgress(state)) {
      void navigate(STEP_PATH[state.step], { replace: true });
    } else if (fresh && state.step === undefined && state.completedAt === undefined) {
      void navigate(firstOnboardingPath(), { replace: true });
    }
  }, [ready, raw, navigate]);
  return null;
}
