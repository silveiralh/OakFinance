// push-test (tech §6.0, US-38): envia "Lembretes ativos" para todas as inscrições ativas do usuário e devolve
// quantas receberam. 404/410 desativam a inscrição; o resultado de cada envio fica registrado.
import { AppError } from '../_shared/errors.ts';
import { type CorsConfig, handleError, jsonResponse, preflight } from '../_shared/http.ts';
import {
  declarativePayload,
  type PushSender,
  type PushTarget,
  type SendResult,
  sendAll,
  type VapidConfig,
} from '../_shared/push.ts';

/** Textos da notificação de teste (UX §6.7, item 17). */
export const TEST_MESSAGE = {
  title: 'Lembretes ativos',
  body: 'É assim que os avisos de vencimento vão aparecer.',
  navigate: '/ajustes/lembretes',
  tag: 'push-test',
} as const;

export interface PushTestDeps {
  cors: CorsConfig;
  appOrigin: string;
  vapid: VapidConfig | null;
  sender(vapid: VapidConfig): PushSender;
  /** Inscrições ativas do dono do token; `null` quando o token não vale. */
  subscriptions(authorization: string): Promise<PushTarget[] | null>;
  record(authorization: string, results: readonly SendResult[]): Promise<void>;
}

export async function handlePushTest(request: Request, deps: PushTestDeps): Promise<Response> {
  const early = preflight(request, deps.cors);
  if (early) {
    return early;
  }
  try {
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    const authorization = request.headers.get('Authorization') ?? '';
    if (!/^Bearer \S+$/.test(authorization)) {
      throw new AppError('UNAUTHORIZED');
    }
    const targets = await deps.subscriptions(authorization);
    if (targets === null) {
      throw new AppError('UNAUTHORIZED');
    }
    if (!deps.vapid) {
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Push não configurado.');
    }
    const payload = declarativePayload(TEST_MESSAGE, deps.appOrigin);
    const results = await sendAll(targets, payload, deps.sender(deps.vapid), {
      topic: 'push-test',
      urgency: 'normal',
    });
    await deps.record(authorization, results);
    return jsonResponse(
      { sent: results.filter((r) => r.outcome === 'sent').length },
      request,
      deps.cors,
    );
  } catch (error) {
    return handleError(error, request, deps.cors);
  }
}
