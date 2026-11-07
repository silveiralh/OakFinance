// S08 — Aparência (UX §3 S01, US-58): tema (Automático / Claro / Escuro; claro por padrão, D-025), transparência,
// movimento e "Abrir com valores ocultos". O tema, a transparência e o movimento valem neste aparelho (oak.env,
// aplicados antes do primeiro paint pelo env.js) e ficam também na conta; valores ocultos é da conta (T-046).
import { useState } from 'react';
import { useAuth } from '../../app/auth';
import { useValuesHidden } from '../../app/values';
import type { LocalRow, OakDb } from '../../data/db';
import { saveRow } from '../../data/repositories/rows';
import { t } from '../../i18n/pt-BR';
import {
  type EnvironmentPrefs,
  type GlassPref,
  type MotionPref,
  readEnvironmentPrefs,
  setEnvironmentPrefs,
  type ThemePref,
} from '../../lib/environment';
import { GlassCard, SegmentedControl, Switch } from '../../ui';

/** Preferências do aparelho como a S08 mostra (sem escolha salva: claro, automática, automático). */
export function appearanceOf(prefs: EnvironmentPrefs): {
  theme: ThemePref;
  glass: GlassPref;
  motion: 'auto' | 'reduced';
} {
  return {
    theme: prefs.theme ?? 'light',
    glass: prefs.glass ?? 'auto',
    motion: prefs.motion === 'reduced' ? 'reduced' : 'auto',
  };
}

/** Mesmas escolhas no formato de `profiles.settings` (ProfileSettings). */
export function profilePatch(prefs: EnvironmentPrefs): Record<string, string | boolean> {
  const patch: Record<string, string | boolean> = {};
  if (prefs.theme) {
    patch.theme = prefs.theme === 'auto' ? 'system' : prefs.theme;
  }
  if (prefs.glass) {
    patch.glass = prefs.glass;
  }
  if (prefs.motion) {
    patch.reduceMotion = prefs.motion === 'reduced' ? 'on' : 'system';
  }
  if (prefs.values) {
    patch.hideValues = prefs.values === 'hidden';
  }
  return patch;
}

async function saveToProfile(db: OakDb, prefs: EnvironmentPrefs): Promise<boolean> {
  const profile = await db.profiles.toCollection().first();
  if (!profile) {
    return false;
  }
  const raw = profile.settings;
  const settings = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
  const result = await saveRow(db, 'profiles', {
    ...profile,
    settings: { ...settings, ...profilePatch(prefs) } as LocalRow<'profiles'>['settings'],
  });
  return result.ok;
}

export function AppearanceScreen() {
  const { user } = useAuth();
  const hidden = useValuesHidden();
  const [current, setCurrent] = useState(() => appearanceOf(readEnvironmentPrefs()));

  const change = (patch: EnvironmentPrefs) => {
    setEnvironmentPrefs(patch);
    setCurrent(appearanceOf(readEnvironmentPrefs()));
    if (user) {
      // grava todas as escolhas do aparelho (não só a que mudou): duas mudanças seguidas não se sobrescrevem
      void saveToProfile(user.db, { ...readEnvironmentPrefs(), ...patch }).then(
        (ok) => ok && user.engine.notifyWrite(),
      );
    }
  };

  return (
    <section className="screen appearance" data-screen="S08" data-testid="screen-S08">
      <GlassCard level={2} className="appearance-card">
        <p className="appearance-label" aria-hidden="true">
          {t('appearance.theme')}
        </p>
        <SegmentedControl
          label={t('appearance.theme')}
          value={current.theme}
          onChange={(theme: ThemePref) => change({ theme })}
          options={[
            { value: 'auto', label: t('appearance.theme.auto') },
            { value: 'light', label: t('appearance.theme.light') },
            { value: 'dark', label: t('appearance.theme.dark') },
          ]}
          data-testid="appearance-theme"
        />
        <p className="appearance-label" aria-hidden="true">
          {t('appearance.glass')}
        </p>
        <SegmentedControl
          label={t('appearance.glass')}
          value={current.glass}
          onChange={(glass: GlassPref) => change({ glass })}
          options={[
            { value: 'auto', label: t('appearance.glass.auto') },
            { value: 'solid', label: t('appearance.glass.solid') },
          ]}
          data-testid="appearance-glass"
        />
        <p className="appearance-label" aria-hidden="true">
          {t('appearance.motion')}
        </p>
        <SegmentedControl
          label={t('appearance.motion')}
          value={current.motion}
          onChange={(motion: 'auto' | 'reduced') => change({ motion: motion as MotionPref })}
          options={[
            { value: 'auto', label: t('appearance.motion.auto') },
            { value: 'reduced', label: t('appearance.motion.reduced') },
          ]}
          data-testid="appearance-motion"
        />
        <Switch
          label={t('appearance.hidden')}
          description={t('appearance.hiddenHint')}
          checked={hidden}
          onChange={(on) => change({ values: on ? 'hidden' : 'shown' })}
          data-testid="appearance-hidden"
        />
      </GlassCard>
    </section>
  );
}
