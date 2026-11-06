// Plataforma e instalação (UX §3 ON01/ON02, US-06, US-07): detecção de iPhone e de modo instalado, o prompt
// nativo do Chrome (`beforeinstallprompt`), `appinstalled` → `persist()` e as escolhas de "pular" guardadas no
// aparelho (preferência de UI em localStorage, só em src/lib/).

export interface NavigatorLike {
  userAgent: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}

/** `isIOS` da UX §3 ON01 (inclui o iPad que se apresenta como Mac). */
export function isIOS(nav: NavigatorLike): boolean {
  return (
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (nav.userAgent.includes('Mac') && (nav.maxTouchPoints ?? 0) > 1)
  );
}

/** Aberto pelo ícone (PWA instalado). */
export function isStandalone(
  nav: NavigatorLike,
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia?.bind(
    globalThis,
  ),
): boolean {
  return Boolean(matchMedia?.('(display-mode: standalone)').matches) || nav.standalone === true;
}

/** Versão do iOS pelo user agent (`[major, minor]`), ou `null` fora do iOS. */
export function iosVersion(ua: string): [number, number] | null {
  const match = /OS (\d+)_(\d+)/.exec(ua);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2])];
}

/** iOS anterior à 16.4: sem Web Push (US-06, "iOS antigo"). */
export function isOldIosWithoutPush(ua: string): boolean {
  const version = iosVersion(ua);
  if (!version || !/iPhone|iPad|iPod/.test(ua)) {
    return false;
  }
  const [major, minor] = version;
  return major < 16 || (major === 16 && minor < 4);
}

export type InstallTarget = 'ios' | 'android' | 'desktop';

export function installTarget(nav: NavigatorLike): InstallTarget {
  if (isIOS(nav)) {
    return 'ios';
  }
  return /Android/.test(nav.userAgent) ? 'android' : 'desktop';
}

// ---------- prompt nativo e estado da instalação ----------

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Listener = () => void;

const state = {
  prompt: null as InstallPromptEvent | null,
  installed: false,
  listeners: new Set<Listener>(),
};

function emit() {
  for (const listener of state.listeners) {
    listener();
  }
}

export function subscribeInstall(listener: Listener): () => void {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function hasInstallPrompt(): boolean {
  return state.prompt !== null;
}

export function wasInstalled(): boolean {
  return state.installed;
}

/** Captura o `beforeinstallprompt` (o Chrome só o dispara uma vez) e o `appinstalled`. */
export function captureInstallEvents(
  target: Pick<Window, 'addEventListener'> = window,
  onInstalled: () => void = () => undefined,
): void {
  target.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    state.prompt = event as InstallPromptEvent;
    emit();
  });
  target.addEventListener('appinstalled', () => {
    state.prompt = null;
    state.installed = true;
    onInstalled();
    emit();
  });
}

/** Abre o diálogo nativo. `true` se a pessoa aceitou. */
export async function promptInstall(): Promise<boolean> {
  const event = state.prompt;
  if (!event) {
    return false;
  }
  await event.prompt();
  const choice = await event.userChoice;
  state.prompt = null;
  emit();
  return choice.outcome === 'accepted';
}

/** Só para os testes. */
export function resetInstallState(): void {
  state.prompt = null;
  state.installed = false;
  state.listeners.clear();
}

// ---------- "Continuar no navegador" e "Agora não" ----------

const KEY = 'oak.install';

export interface InstallChoices {
  /** iPhone: "Continuar no navegador por enquanto" (card no Início). */
  skipped: boolean;
  /** Android/computador: "Agora não"; o card volta após 3 dias, no máximo 2 vezes (UX §3 ON02a). */
  dismissedAt: string | null;
  dismissCount: number;
}

const EMPTY: InstallChoices = { skipped: false, dismissedAt: null, dismissCount: 0 };

export function readInstallChoices(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): InstallChoices {
  try {
    const raw = storage?.getItem(KEY);
    const value = raw ? (JSON.parse(raw) as Partial<InstallChoices>) : {};
    return {
      skipped: value.skipped === true,
      dismissedAt: typeof value.dismissedAt === 'string' ? value.dismissedAt : null,
      dismissCount: typeof value.dismissCount === 'number' ? value.dismissCount : 0,
    };
  } catch {
    return EMPTY;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function write(
  choices: InstallChoices,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
) {
  try {
    storage?.setItem(KEY, JSON.stringify(choices));
  } catch {
    // sem armazenamento: a escolha vale só nesta abertura
  }
}

export function markInstallSkipped(): void {
  write({ ...readInstallChoices(), skipped: true });
}

export function markInstallDismissed(nowMs: number = Date.now()): void {
  const current = readInstallChoices();
  write({
    ...current,
    dismissedAt: new Date(nowMs).toISOString(),
    dismissCount: current.dismissCount + 1,
  });
}

export const DISMISS_DAYS = 3;
export const MAX_REMINDERS = 2;

/** Mostrar o card "Instale o app para receber lembretes" no Início? */
export function showInstallCard(
  choices: InstallChoices,
  standalone: boolean,
  nowMs: number = Date.now(),
): boolean {
  if (standalone) {
    return false;
  }
  if (choices.skipped) {
    return true;
  }
  if (!choices.dismissedAt) {
    return false;
  }
  const elapsed = nowMs - Date.parse(choices.dismissedAt);
  return choices.dismissCount <= MAX_REMINDERS && elapsed >= DISMISS_DAYS * 86_400_000;
}
