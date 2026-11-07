// Códigos de erro estáveis das Edge Functions (tech §6.0, §2.3).
// O app traduz o código para o texto do UX §6.6; a mensagem aqui é só para diagnóstico
// e nunca contém valores, descrições de lançamento ou dados pessoais.

export const ERRORS = {
  BAD_REQUEST: { status: 400, message: 'Requisição inválida.' },
  UNAUTHORIZED: { status: 401, message: 'Autenticação necessária.' },
  FORBIDDEN: { status: 403, message: 'Acesso negado.' },
  ORIGIN_NOT_ALLOWED: { status: 403, message: 'Origem não permitida.' },
  NOT_FOUND: { status: 404, message: 'Recurso não encontrado.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Método não permitido.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Corpo da requisição grande demais.' },
  RATE_LIMITED: { status: 429, message: 'Muitas requisições. Tente de novo em instantes.' },
  // Open Finance (T-073, US-45)
  ITEM_NOT_FOUND: {
    status: 404,
    message: 'Não encontramos essa conexão no Meu Pluggy. Confira o código.',
  },
  ITEM_FOREIGN: { status: 409, message: 'Essa conexão pertence a outra conta.' },
  CONNECTOR_NOT_ALLOWED: { status: 403, message: 'Conector não permitido.' },
  INTERNAL: { status: 500, message: 'Erro interno.' },
  UPSTREAM_UNAVAILABLE: { status: 502, message: 'Serviço externo indisponível.' },
  UPSTREAM_TIMEOUT: { status: 504, message: 'Serviço externo não respondeu a tempo.' },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERRORS;

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERRORS, value);
}

export function errorBody(code: ErrorCode, message?: string): ErrorBody {
  return { error: { code, message: message ?? ERRORS[code].message } };
}

/** Erro com código estável, lançado nos handlers e convertido em resposta por `handleError`. */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? ERRORS[code].message);
    this.name = 'AppError';
    this.code = code;
  }

  get status(): number {
    return ERRORS[this.code].status;
  }
}
