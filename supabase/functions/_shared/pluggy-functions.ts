// Peças comuns das funções `pluggy-*` chamadas pelo app (tech §6.0 e §6.1.3): auth do usuário, rate limit
// (`rate_limit_hit`, migração 10), leitura do corpo e tradução dos erros do agregador para os códigos estáveis.
import { ProviderError } from './connectors/types.ts';
import { AppError } from './errors.ts';

/** Limites por usuário (janela de 1 h). */
export const RATE_LIMITS = {
  'pluggy-connect': 20,
  'pluggy-link': 20,
  // tech §6.1.4: pelo app, 6 chamadas por hora por usuário
  'pluggy-sync': 6,
  // tech §6.2.3: 30 consultas de NFC-e por hora por usuário
  'nfce-fetch': 30,
} as const;
export const RATE_WINDOW_SECONDS = 3600;

export type RateBucket = keyof typeof RATE_LIMITS;

/** O que as funções precisam saber de quem chama. */
export interface Caller {
  userId: string;
  /** Conta uma chamada no balde; `false` = passou do limite. */
  hit(bucket: RateBucket, limit: number, windowSeconds: number): Promise<boolean>;
}

/** `Authorization: Bearer <jwt>` obrigatório; o token inválido vira `UNAUTHORIZED`. */
export async function requireCaller(
  request: Request,
  resolve: (authorization: string) => Promise<Caller | null>,
): Promise<Caller> {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization)) {
    throw new AppError('UNAUTHORIZED');
  }
  const caller = await resolve(authorization);
  if (!caller) {
    throw new AppError('UNAUTHORIZED');
  }
  return caller;
}

export async function enforceRate(caller: Caller, bucket: RateBucket): Promise<void> {
  if (!(await caller.hit(bucket, RATE_LIMITS[bucket], RATE_WINDOW_SECONDS))) {
    throw new AppError('RATE_LIMITED');
  }
}

/** Erro do agregador → código estável; nunca a resposta crua. */
export function fromProvider(error: unknown): unknown {
  if (!(error instanceof ProviderError)) {
    return error;
  }
  switch (error.code) {
    case 'ITEM_NOT_FOUND':
      return new AppError('ITEM_NOT_FOUND');
    case 'RATE_LIMITED':
      return new AppError('RATE_LIMITED');
    default:
      return new AppError('UPSTREAM_UNAVAILABLE');
  }
}

/** Item ID da Pluggy (UUID ou id de teste): letras, dígitos e hífen, até 100 caracteres. */
export const ITEM_ID_RE = /^[A-Za-z0-9-]{1,100}$/;

export function readItemId(body: unknown, required: boolean): string | undefined {
  const value = (body as { itemId?: unknown } | null)?.itemId;
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new AppError('BAD_REQUEST', 'itemId é obrigatório.');
    }
    return undefined;
  }
  if (typeof value !== 'string' || !ITEM_ID_RE.test(value.trim())) {
    // código colado errado: mesma mensagem do Item ID inexistente (US-45)
    throw new AppError('ITEM_NOT_FOUND');
  }
  return value.trim();
}
