// Registro do Service Worker e atualização sob pedido (tech §4.8, US-03, G07). O SW novo fica em espera até o
// toque em "Atualizar"; a recarga só acontece quando nada a impede (lançamento em digitação, T-040).
import { Workbox } from 'workbox-window';

export interface WorkboxLike {
  addEventListener(type: 'waiting' | 'controlling', listener: () => void): void;
  register(): Promise<unknown>;
  messageSkipWaiting(): void;
}

type Listener = () => void;

const state = {
  workbox: null as WorkboxLike | null,
  updateReady: false,
  activated: false,
  listeners: new Set<Listener>(),
};

function emit() {
  for (const listener of state.listeners) {
    listener();
  }
}

/** Há versão nova esperando o "Atualizar". */
export function isUpdateReady(): boolean {
  return state.updateReady;
}

/** A versão nova já assumiu o controle: falta só recarregar. */
export function isUpdateActivated(): boolean {
  return state.activated;
}

export function subscribeUpdate(listener: Listener): () => void {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export interface RegisterOptions {
  serviceWorker?: unknown;
  enabled?: boolean;
  create?: (url: string) => WorkboxLike;
}

/**
 * Registra `/sw.js` (só no build, nunca no `vite dev`). Devolve `false` quando o navegador não tem Service
 * Worker: o app funciona igual, só sem abrir offline.
 */
export async function registerServiceWorker({
  serviceWorker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
  enabled = import.meta.env.PROD,
  create = (url) => new Workbox(url),
}: RegisterOptions = {}): Promise<boolean> {
  if (!enabled || !serviceWorker || state.workbox) {
    return false;
  }
  const workbox = create('/sw.js');
  state.workbox = workbox;
  workbox.addEventListener('waiting', () => {
    state.updateReady = true;
    emit();
  });
  workbox.addEventListener('controlling', () => {
    if (state.updateReady) {
      state.activated = true;
      emit();
    }
  });
  try {
    await workbox.register();
    return true;
  } catch (error) {
    console.error('Service Worker não registrado', error);
    return false;
  }
}

/** Toque em "Atualizar": pede ao SW em espera para assumir (`SKIP_WAITING`). */
export function applyUpdate(): void {
  if (state.workbox && state.updateReady) {
    state.workbox.messageSkipWaiting();
  }
}

/** Só para os testes. */
export function resetUpdateState(): void {
  state.workbox = null;
  state.updateReady = false;
  state.activated = false;
  state.listeners.clear();
}
