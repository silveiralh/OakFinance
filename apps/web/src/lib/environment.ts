// Atributos de ambiente (UX §4.10). Quem resolve é o public/env.js, antes do primeiro paint; aqui ficam a leitura
// dos atributos, a assinatura de mudanças e a gravação das preferências de UI (localStorage só em src/lib/).
export type ThemePref = 'auto' | 'light' | 'dark';
export type GlassPref = 'auto' | 'solid';
export type MotionPref = 'auto' | 'full' | 'reduced';

export interface EnvironmentPrefs {
  theme?: ThemePref;
  glass?: GlassPref;
  motion?: MotionPref;
  values?: 'shown' | 'hidden';
}

export interface Environment {
  theme: 'light' | 'dark';
  glass: 'glass' | 'solid';
  motion: 'full' | 'reduced';
  perf: 'normal' | 'low';
  values: 'shown' | 'hidden';
}

declare global {
  interface Window {
    oakEnv?: {
      key: string;
      apply: () => Environment;
      resolve: (prefs: EnvironmentPrefs) => Environment;
    };
  }
}

export const ENV_STORAGE_KEY = 'oak.env';
export const ENV_ATTRIBUTES = [
  'data-theme',
  'data-glass',
  'data-motion',
  'data-perf',
  'data-values',
] as const;

function attr<T extends string>(
  root: HTMLElement,
  name: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = root.getAttribute(name);
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Os 5 valores em vigor no <html>, com os padrões quando o script de ambiente não rodou. */
export function readEnvironment(root: HTMLElement = document.documentElement): Environment {
  return {
    theme: attr(root, 'data-theme', ['light', 'dark'], 'light'),
    glass: attr(root, 'data-glass', ['glass', 'solid'], 'glass'),
    motion: attr(root, 'data-motion', ['full', 'reduced'], 'full'),
    perf: attr(root, 'data-perf', ['normal', 'low'], 'normal'),
    values: attr(root, 'data-values', ['shown', 'hidden'], 'shown'),
  };
}

/** Preferências salvas (podem faltar ou estar corrompidas: nunca lança). */
export function readEnvironmentPrefs(): EnvironmentPrefs {
  try {
    const raw = window.localStorage.getItem(ENV_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as EnvironmentPrefs)
      : {};
  } catch {
    return {};
  }
}

/** Grava as preferências e reaplica o ambiente. Sem armazenamento disponível, aplica só nesta sessão. */
export function setEnvironmentPrefs(patch: EnvironmentPrefs): Environment {
  const next = { ...readEnvironmentPrefs(), ...patch };
  try {
    window.localStorage.setItem(ENV_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // modo privado ou cota cheia: segue sem persistir
  }
  if (window.oakEnv) {
    return window.oakEnv.apply();
  }
  // sem o script de ambiente (testes, falha de carga): aplica só o que é explícito
  const root = document.documentElement;
  if (next.theme === 'light' || next.theme === 'dark') {
    root.setAttribute('data-theme', next.theme);
  }
  if (next.values) {
    root.setAttribute('data-values', next.values);
  }
  return readEnvironment(root);
}

/** Avisa a cada mudança de um atributo de ambiente; devolve a função para cancelar. */
export function subscribeEnvironment(
  onChange: () => void,
  root: HTMLElement = document.documentElement,
): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(root, { attributes: true, attributeFilter: [...ENV_ATTRIBUTES] });
  return () => observer.disconnect();
}
