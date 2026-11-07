// Web Push no aparelho (tech §6.4.1 e §6.4.2, US-38): suporte, plataforma, permissão (só em toque), inscrição com a
// chave pública VAPID e registro pela RPC `upsert_push_subscription`. O envio de teste chama a função `push-test`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { type InvokeOptions, invokeFunction } from './functions';

export type PushPlatform = 'android' | 'ios' | 'desktop' | 'other';

/**
 * Estado na S07: `unsupported` (sem PushManager), `ios-not-installed` (iPhone fora da Tela de Início),
 * `unconfigured` (build sem chave VAPID), `denied` (bloqueado no sistema), `off` (pode ativar), `on` (inscrito).
 */
export type PushState =
  | 'unsupported'
  | 'ios-not-installed'
  | 'unconfigured'
  | 'denied'
  | 'off'
  | 'on';

export interface PushEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  hasPushManager: boolean;
  hasServiceWorker: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | null;
}

export function platformOf(userAgent: string, maxTouchPoints = 0): PushPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/.test(userAgent)) {
    return 'android';
  }
  return /Windows|Macintosh|Linux|CrOS/.test(userAgent) ? 'desktop' : 'other';
}

/** Estado antes de olhar a inscrição (sem `on`). */
export function baseState(env: PushEnvironment, vapidKey: string | null): Exclude<PushState, 'on'> {
  const ios = platformOf(env.userAgent, env.maxTouchPoints) === 'ios';
  if (ios && !env.standalone) {
    return 'ios-not-installed';
  }
  if (!env.hasPushManager || !env.hasServiceWorker || !env.hasNotification) {
    return 'unsupported';
  }
  if (!vapidKey) {
    return 'unconfigured';
  }
  return env.permission === 'denied' ? 'denied' : 'off';
}

export function readEnvironment(): PushEnvironment {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const win = typeof window === 'undefined' ? null : window;
  let standalone = false;
  try {
    standalone =
      Boolean(win?.matchMedia?.('(display-mode: standalone)').matches) ||
      (nav as (Navigator & { standalone?: boolean }) | null)?.standalone === true;
  } catch {
    standalone = false;
  }
  const hasNotification = Boolean(win && 'Notification' in win);
  return {
    userAgent: nav?.userAgent ?? '',
    maxTouchPoints: nav?.maxTouchPoints ?? 0,
    standalone,
    hasPushManager: Boolean(win && 'PushManager' in win),
    hasServiceWorker: Boolean(nav && 'serviceWorker' in nav),
    hasNotification,
    permission: hasNotification ? Notification.permission : null,
  };
}

/** Chave VAPID base64url → bytes para `applicationServerKey`. */
export function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    return await (await registration()).pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** Grava (ou renova) a inscrição no servidor. */
export async function registerSubscription(
  client: SupabaseClient,
  subscription: PushSubscription,
  deviceId: string,
): Promise<boolean> {
  const json = subscription.toJSON();
  const { error } = await client.rpc('upsert_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_platform: platformOf(navigator.userAgent, navigator.maxTouchPoints),
    p_user_agent: navigator.userAgent.slice(0, 300),
    p_device_id: deviceId,
  });
  return !error;
}

/**
 * Ativar (chamar só dentro de um toque, tech §6.4.1): pede a permissão, inscreve com a chave VAPID e registra.
 * Devolve o novo estado.
 */
export async function enablePush(
  client: SupabaseClient,
  vapidKey: string,
  deviceId: string,
): Promise<'on' | 'denied' | 'off'> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return permission === 'denied' ? 'denied' : 'off';
  }
  const reg = await registration();
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(vapidKey),
    }));
  return (await registerSubscription(client, subscription, deviceId)) ? 'on' : 'off';
}

export async function disablePush(client: SupabaseClient): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) {
    return;
  }
  await client.rpc('delete_push_subscription', { p_endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

/** Envia a notificação de teste; devolve quantos aparelhos receberam ou `null` em erro. */
/** Notificação de teste (push-test): quantas inscrições receberam, ou o motivo da falha (G13 no timeout). */
export async function sendTestPush(
  client: SupabaseClient,
  options: InvokeOptions = {},
): Promise<number | null | 'timeout'> {
  const result = await invokeFunction<{ sent: number }>(client, 'push-test', {}, options);
  if (result.ok) {
    return result.data.sent;
  }
  return result.reason === 'timeout' ? 'timeout' : null;
}
