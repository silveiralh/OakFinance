// Envio de Web Push (tech §6.4.3 e §6.4.4). Payload no formato Declarative Web Push; chaves VAPID em base64url
// (pública de 65 bytes, privada de 32). A criptografia (aes128gcm) e o JWT VAPID vêm do `web-push` (plano B da
// spec, D-046); o envio é um `fetch` comum, para funcionar em qualquer endpoint (FCM, Apple, e o servidor de teste).
// @ts-types="npm:@types/web-push@3.6.4"
import webpush from 'web-push';
import type { EnvReader } from './http.ts';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Rota do app (ex.: '/planejar/futuro'); vira URL absoluta com a origem do app. */
  navigate: string;
  /** `tag` da notificação (substitui uma anterior com a mesma tag). */
  tag: string;
  badge?: number;
}

export interface SendOptions {
  topic: string;
  urgency: 'normal' | 'high';
  ttlSeconds?: number;
}

/** Resultado por inscrição: 2xx enviado; 404/410 inscrição morta; 429/5xx tentar de novo; o resto é erro. */
export type SendOutcome = 'sent' | 'gone' | 'retry' | 'error';

export interface SendResult {
  id: string;
  outcome: SendOutcome;
  status: number;
}

export interface PushSender {
  /** Devolve o status HTTP do serviço de push (0 quando a rede falhou). */
  send(target: PushTarget, payload: string, options: SendOptions): Promise<number>;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
export const DEFAULT_TTL_SECONDS = 43_200; // 12 h (tech §6.4.3)

function decodedLength(b64url: string): number {
  return Math.floor((b64url.length * 3) / 4);
}

/** VAPID das variáveis de ambiente; `null` quando falta alguma ou o formato não confere. */
export function vapidFromEnv(env: EnvReader): VapidConfig | null {
  const publicKey = env.get('VAPID_PUBLIC_KEY')?.trim() ?? '';
  const privateKey = env.get('VAPID_PRIVATE_KEY')?.trim() ?? '';
  const subject = env.get('VAPID_SUBJECT')?.trim() ?? '';
  if (
    !B64URL.test(publicKey) ||
    !B64URL.test(privateKey) ||
    decodedLength(publicKey) !== 65 ||
    decodedLength(privateKey) !== 32 ||
    !/^(mailto:|https:\/\/)/.test(subject)
  ) {
    return null;
  }
  return { publicKey, privateKey, subject };
}

/** Payload Declarative Web Push (tech §6.4.3 [CONTRATO]). */
export function declarativePayload(message: PushMessage, appOrigin: string): string {
  const origin = appOrigin.replace(/\/+$/, '');
  const path = message.navigate.startsWith('/') ? message.navigate : `/${message.navigate}`;
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: message.title,
      body: message.body,
      navigate: `${origin}${path}`,
      lang: 'pt-BR',
      tag: message.tag,
      silent: false,
      ...(message.badge !== undefined ? { app_badge: message.badge } : {}),
    },
  });
}

export function classify(status: number): SendOutcome {
  if (status >= 200 && status < 300) {
    return 'sent';
  }
  if (status === 404 || status === 410) {
    return 'gone';
  }
  if (status === 0 || status === 429 || status >= 500) {
    return 'retry';
  }
  return 'error';
}

/** Sender real: cifra com `web-push` e envia com `fetch`. */
export function webPushSender(vapid: VapidConfig, fetchImpl: typeof fetch = fetch): PushSender {
  return {
    async send(target, payload, options) {
      const details = webpush.generateRequestDetails(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        {
          vapidDetails: vapid,
          TTL: options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
          urgency: options.urgency,
          topic: options.topic,
          contentEncoding: 'aes128gcm',
        },
      );
      const headers = new Headers();
      for (const [name, value] of Object.entries(details.headers)) {
        headers.set(name, String(value));
      }
      try {
        const response = await fetchImpl(details.endpoint, {
          method: details.method,
          headers,
          body: details.body ? new Uint8Array(details.body) : null,
        });
        await response.body?.cancel();
        return response.status;
      } catch {
        return 0;
      }
    },
  };
}

/** Envia para todas as inscrições, uma de cada vez, sem parar na primeira falha. */
export async function sendAll(
  targets: readonly PushTarget[],
  payload: string,
  sender: PushSender,
  options: SendOptions,
): Promise<SendResult[]> {
  const results: SendResult[] = [];
  for (const target of targets) {
    let status = 0;
    try {
      status = await sender.send(target, payload, options);
    } catch {
      status = 0;
    }
    results.push({ id: target.id, outcome: classify(status), status });
  }
  return results;
}
