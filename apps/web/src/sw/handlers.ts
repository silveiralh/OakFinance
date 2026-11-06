// Lógica do Service Worker separada dos eventos (tech §4.8, §6.4.3), com dependências injetadas para o teste
// unitário com eventos simulados (tech §8.4). O `sw.ts` só liga estes handlers aos eventos do `self`.

/** Mensagem do app para o SW: ativar a versão em espera (só com o toque em "Atualizar"). */
export const SKIP_WAITING = 'SKIP_WAITING';
/** Mensagem do SW para as janelas abertas: rodar o sync (Background Sync, só Chromium). */
export const RUN_SYNC = 'RUN_SYNC';
/** Mensagem do SW para as janelas: a inscrição de push mudou e precisa ser refeita. */
export const PUSH_RESUBSCRIBE = 'PUSH_RESUBSCRIBE';

export const APP_NAME = 'OakFinance';
export const NOTIFICATION_ICON = '/icons/icon-192.png';
export const NOTIFICATION_BADGE = '/icons/badge-96.png';

/** Payload Declarative Web Push [CONTRATO] (tech §6.4.3). */
export interface DeclarativePush {
  web_push?: number;
  notification?: {
    title?: string;
    body?: string;
    navigate?: string;
    lang?: string;
    tag?: string;
    silent?: boolean;
    app_badge?: number;
  };
}

export interface NotificationSpec {
  title: string;
  options: {
    body?: string;
    lang: string;
    tag?: string;
    silent: boolean;
    icon: string;
    badge: string;
    data: { navigate: string };
  };
  badgeCount: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Só caminhos do próprio app: URL de outra origem (ou inválida) vira o Início. */
export function safeNavigate(raw: unknown, origin: string): string {
  if (typeof raw !== 'string' || raw === '') {
    return '/';
  }
  try {
    const url = new URL(raw, origin);
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}

/**
 * Notificação a mostrar para um push. **Sempre** devolve uma notificação, mesmo com payload vazio ou inválido,
 * porque push silencioso faz o Safari revogar a permissão (tech §4.8).
 */
export function notificationFromPush(payload: unknown, origin: string): NotificationSpec {
  const raw = isRecord(payload) && isRecord(payload.notification) ? payload.notification : {};
  const text = (key: string) => {
    const value = raw[key];
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
  };
  const badge = raw.app_badge;
  const body = text('body');
  const tag = text('tag');
  return {
    title: text('title') ?? APP_NAME,
    options: {
      ...(body !== undefined && { body }),
      lang: text('lang') ?? 'pt-BR',
      ...(tag !== undefined && { tag }),
      silent: raw.silent === true,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      data: { navigate: safeNavigate(raw.navigate, origin) },
    },
    badgeCount: typeof badge === 'number' && Number.isInteger(badge) && badge >= 0 ? badge : null,
  };
}

/** Lê o corpo do push como JSON; texto que não é JSON vira o corpo da notificação. */
export function parsePushData(text: string | null): unknown {
  if (text === null || text === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { notification: { body: text } };
  }
}

export interface WindowClientLike {
  url: string;
  focused?: boolean;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
  postMessage(message: unknown): void;
}

export interface ClientsLike {
  matchAll(options: {
    type: 'window';
    includeUncontrolled: boolean;
  }): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
}

/**
 * Clique na notificação: foca uma janela do app (a já focada, se houver) e navega para `data.navigate`; sem
 * janela aberta, abre uma nova. O app sincroniza ao ganhar foco (tech §4.8).
 */
export async function openFromNotification(
  clients: ClientsLike,
  data: unknown,
  origin: string,
): Promise<void> {
  const path = safeNavigate(isRecord(data) ? data.navigate : undefined, origin);
  const target = new URL(path, origin).href;
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows.find((w) => w.focused) ?? windows[0];
  if (!client) {
    await clients.openWindow(target);
    return;
  }
  await client.focus();
  if (client.url === target) {
    return;
  }
  if (client.navigate) {
    try {
      await client.navigate(target);
      return;
    } catch {
      // janela não controlada por este SW: o app navega pela mensagem
    }
  }
  client.postMessage({ type: 'NAVIGATE', url: path });
}

/** Avisa todas as janelas abertas (Background Sync e troca de inscrição de push). */
export async function broadcast(clients: ClientsLike, message: { type: string }): Promise<number> {
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    client.postMessage(message);
  }
  return windows.length;
}

/** `true` se a mensagem pede para ativar a versão em espera. */
export function isSkipWaiting(data: unknown): boolean {
  return isRecord(data) && data.type === SKIP_WAITING;
}
