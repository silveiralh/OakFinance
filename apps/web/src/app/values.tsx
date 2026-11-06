// Ocultar valores (US-57, RN-103, UX P9): botão olho no topo do Início com `aria-pressed`; `data-values` no
// `<html>` (preferência do aparelho em `oak.env`) e `profiles.settings.hideValues` (preferência da conta). Os valores
// viram "R$ ••••" e o leitor de tela ouve "Valor oculto"; o valor em digitação no Q01 continua visível.
import { HIDDEN_AMOUNT } from '@oakfinance/domain';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect } from 'react';
import type { LocalRow } from '../data/db';
import { useLive } from '../data/live';
import { saveRow } from '../data/repositories/rows';
import { t, uiText } from '../i18n/pt-BR';
import { setEnvironmentPrefs } from '../lib/environment';
import { useEnvironment } from '../lib/useEnvironment';
import { IconButton } from '../ui';
import { useAuth } from './auth';

export function useValuesHidden(): boolean {
  return useEnvironment().values === 'hidden';
}

/** Texto com valores: oculto vira "R$ ••••". */
export function maskMoney(text: string, hidden: boolean): string {
  return hidden ? HIDDEN_AMOUNT : text;
}

/** Valor em texto que obedece o ocultar: visualmente "R$ ••••", para o leitor de tela "Valor oculto". */
export function Amount({ text, hidden }: { text: string; hidden: boolean }) {
  if (!hidden) {
    return <>{text}</>;
  }
  return (
    <>
      <span aria-hidden="true">{HIDDEN_AMOUNT}</span>
      <span className="sr-only">{uiText.hiddenValue}</span>
    </>
  );
}

type Profile = LocalRow<'profiles'>;

function settingsOf(profile: Profile | undefined): Record<string, unknown> {
  const raw = profile?.settings;
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function useProfile(): Profile | undefined | null {
  const { user } = useAuth();
  return useLive(
    user ? async () => (await user.db.profiles.toCollection().first()) ?? null : null,
    [user],
  );
}

/** Botão olho (UX §3 H01): alterna e grava no aparelho e na conta. */
export function HideValuesButton() {
  const { user } = useAuth();
  const hidden = useValuesHidden();
  const toggle = async () => {
    const next = !hidden;
    setEnvironmentPrefs({ values: next ? 'hidden' : 'shown' });
    const profile = user ? await user.db.profiles.toCollection().first() : undefined;
    if (user && profile) {
      const result = await saveRow(user.db, 'profiles', {
        ...profile,
        settings: { ...settingsOf(profile), hideValues: next },
      });
      if (result.ok) {
        user.engine.notifyWrite();
      }
    }
  };
  return (
    <IconButton
      icon={hidden ? EyeOff : Eye}
      label={hidden ? t('home.show') : t('home.hide')}
      variant="plain"
      pressed={hidden}
      onClick={() => void toggle()}
      data-testid="hide-values"
    />
  );
}

/** A preferência da conta vale também neste aparelho quando o perfil chega ou muda (outro aparelho). */
export function ValuesFromProfile() {
  const profile = useProfile();
  const wanted = settingsOf(profile ?? undefined).hideValues;
  useEffect(() => {
    if (typeof wanted === 'boolean') {
      setEnvironmentPrefs({ values: wanted ? 'hidden' : 'shown' });
    }
  }, [wanted]);
  return null;
}
