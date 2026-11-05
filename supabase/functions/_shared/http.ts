// CORS e formato de resposta das Edge Functions (tech §6.0).
// Origens permitidas: APP_ORIGIN, subdomínios com o sufixo APP_PREVIEW_ORIGIN_SUFFIX
// (previews do Pages, ex.: `.oakfinance.pages.dev`) e http://localhost:5173.
import { AppError, ERRORS, type ErrorCode, errorBody } from './errors.ts';

export const LOCAL_DEV_ORIGIN = 'http://localhost:5173';

export interface CorsConfig {
  appOrigin?: string;
  previewOriginSuffix?: string;
}

export interface EnvReader {
  get(name: string): string | undefined;
}

export function readCorsConfig(env: EnvReader): CorsConfig {
  const config: CorsConfig = {};
  const appOrigin = env.get('APP_ORIGIN')?.trim();
  const suffix = env.get('APP_PREVIEW_ORIGIN_SUFFIX')?.trim();
  if (appOrigin) {
    config.appOrigin = appOrigin.replace(/\/+$/, '');
  }
  if (suffix) {
    config.previewOriginSuffix = suffix.startsWith('.') ? suffix : `.${suffix}`;
  }
  return config;
}

export function isAllowedOrigin(origin: string | null, config: CorsConfig): origin is string {
  if (!origin) {
    return false;
  }
  if (origin === LOCAL_DEV_ORIGIN || origin === config.appOrigin) {
    return true;
  }
  if (!config.previewOriginSuffix) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname;
  const suffix = config.previewOriginSuffix;
  return (
    url.protocol === 'https:' &&
    url.origin === origin &&
    host.endsWith(suffix) &&
    host.length > suffix.length
  );
}

export const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type';
export const ALLOWED_METHODS = 'POST, OPTIONS';

export function corsHeaders(origin: string | null, config: CorsConfig): Headers {
  const headers = new Headers({ Vary: 'Origin' });
  if (isAllowedOrigin(origin, config)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}

/** Responde o preflight. Devolve `null` quando a requisição não é OPTIONS. */
export function preflight(request: Request, config: CorsConfig): Response | null {
  if (request.method !== 'OPTIONS') {
    return null;
  }
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin, config)) {
    return errorResponse('ORIGIN_NOT_ALLOWED', request, config);
  }
  return new Response(null, { status: 204, headers: corsHeaders(origin, config) });
}

export function jsonResponse(
  body: unknown,
  request: Request,
  config: CorsConfig,
  status = 200,
): Response {
  const headers = corsHeaders(request.headers.get('Origin'), config);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export function errorResponse(
  code: ErrorCode,
  request: Request,
  config: CorsConfig,
  message?: string,
): Response {
  return jsonResponse(errorBody(code, message), request, config, ERRORS[code].status);
}

/** Converte qualquer erro em resposta padronizada; erros desconhecidos viram INTERNAL sem detalhes. */
export function handleError(error: unknown, request: Request, config: CorsConfig): Response {
  if (error instanceof AppError) {
    return errorResponse(error.code, request, config, error.message);
  }
  return errorResponse('INTERNAL', request, config);
}

/** Lê o corpo JSON; corpo ausente ou inválido vira BAD_REQUEST. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError('BAD_REQUEST', 'Corpo JSON inválido.');
  }
}
