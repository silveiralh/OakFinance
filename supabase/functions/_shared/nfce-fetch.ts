// `nfce-fetch` (tech §6.0 [CONTRATO] e §6.2.3; RN-82, RN-84, D-005). Busca a página pública da NFC-e na SEFAZ-PR e
// devolve os itens lidos por `parseNfcePage`. Anti-SSRF: só `fazenda.pr.gov.br` e `www.fazenda.pr.gov.br`, caminho
// fixo `/nfce/qrcode` e a URL **reconstruída** a partir do `p` validado (nunca a string crua do QR); redirects só
// dentro da allowlist (no máximo 3); corpo até 2 MB; timeout de 10 s por tentativa e 1 nova tentativa em 5xx ou
// timeout. Sem estado no servidor: o app grava recibo, itens e lançamento pelo sync normal.
import { DomainError, NFCE_UF_PR, type NfceQr, parseNfceQr } from './domain/index.ts';
import { AppError } from './errors.ts';
import { type CorsConfig, handleError, jsonResponse, preflight, readJson } from './http.ts';
import { type NfceParsed, parseNfcePage } from './nfce/index.ts';
import { type Caller, enforceRate, requireCaller } from './pluggy-functions.ts';

export const NFCE_ALLOWED_HOSTS = ['www.fazenda.pr.gov.br', 'fazenda.pr.gov.br'] as const;
export const NFCE_BASE_URL = 'https://www.fazenda.pr.gov.br';
export const NFCE_PATH = '/nfce/qrcode';
export const NFCE_TIMEOUT_MS = 10_000;
export const NFCE_MAX_BYTES = 2 * 1024 * 1024;
export const NFCE_MAX_REDIRECTS = 3;
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

export type NfceErrorCode = 'NFCE_UNAVAILABLE' | 'NFCE_LAYOUT' | 'NFCE_CAPTCHA' | 'NFCE_TIMEOUT';

export interface NfceFetchBody {
  status: 'full' | 'fallback';
  qr: NfceQr;
  receipt: NfceParsed | null;
  errorCode?: NfceErrorCode;
}

export interface NfceDeps {
  cors: CorsConfig;
  caller(authorization: string): Promise<Caller | null>;
  fetch: typeof fetch;
  /** Base da SEFAZ-PR; só muda com `APP_ENV=local` e `NFCE_TEST_BASE_URL` (ver `nfceBaseUrl`). */
  baseUrl: string;
  timeoutMs?: number;
}

/** `NFCE_TEST_BASE_URL` só vale em `APP_ENV=local`; em qualquer outro ambiente a base é a da SEFAZ-PR. */
export function nfceBaseUrl(env: { get(name: string): string | undefined }): string {
  const test = env.get('NFCE_TEST_BASE_URL');
  return env.get('APP_ENV') === 'local' && test ? test.replace(/\/+$/, '') : NFCE_BASE_URL;
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.hostname.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

/** Host do QR na allowlist da SEFAZ-PR (RN-82). */
export function isAllowedNfceHost(url: string): boolean {
  const host = hostOf(url);
  return host !== null && (NFCE_ALLOWED_HOSTS as readonly string[]).includes(host);
}

/** `p` do QR já validado pelo domínio: só os caracteres que a SEFAZ usa. */
const P_RE = /^[0-9A-Za-z|.+/=_-]{44,400}$/;

/** URL buscada, reconstruída a partir dos campos validados. */
export function rebuildNfceUrl(qr: NfceQr, baseUrl: string): string | null {
  const p = new URL(qr.url).searchParams.get('p')?.trim() ?? '';
  if (!P_RE.test(p) || !p.startsWith(qr.accessKey)) {
    return null;
  }
  return `${baseUrl}${NFCE_PATH}?p=${encodeURIComponent(p)}`;
}

class Fallback extends Error {
  constructor(readonly code: NfceErrorCode) {
    super(code);
  }
}

async function readLimited(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > NFCE_MAX_BYTES) {
    throw new Fallback('NFCE_UNAVAILABLE');
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > NFCE_MAX_BYTES) {
        await reader.cancel();
        throw new Fallback('NFCE_UNAVAILABLE');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const charset = /charset=([\w-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Uma tentativa: segue até 3 redirects, todos dentro da allowlist (ou da base local de teste). */
async function attempt(
  url: string,
  deps: NfceDeps,
  allowed: (u: string) => boolean,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? NFCE_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      let response: Response;
      try {
        response = await deps.fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html',
            'Accept-Language': 'pt-BR',
          },
        });
      } catch {
        throw new Fallback(controller.signal.aborted ? 'NFCE_TIMEOUT' : 'NFCE_UNAVAILABLE');
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || hop >= NFCE_MAX_REDIRECTS) {
          throw new Fallback('NFCE_UNAVAILABLE');
        }
        const next = new URL(location, current).toString();
        if (!allowed(next)) {
          // redirect para fora da allowlist: não segue (anti-SSRF)
          throw new Fallback('NFCE_UNAVAILABLE');
        }
        current = next;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Fallback('NFCE_UNAVAILABLE');
      }
      try {
        return await readLimited(response);
      } catch (error) {
        if (error instanceof Fallback) {
          throw error;
        }
        throw new Fallback(controller.signal.aborted ? 'NFCE_TIMEOUT' : 'NFCE_UNAVAILABLE');
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function retriable(error: unknown): boolean {
  return (
    error instanceof Fallback &&
    (error.code === 'NFCE_TIMEOUT' || error.code === 'NFCE_UNAVAILABLE')
  );
}

/** Busca a página (com 1 nova tentativa em 5xx/timeout) e lê os itens. Nunca lança: falha vira `fallback`. */
export async function fetchNfce(qr: NfceQr, deps: NfceDeps): Promise<NfceFetchBody> {
  const fallback = (errorCode: NfceErrorCode): NfceFetchBody => ({
    status: 'fallback',
    qr,
    receipt: null,
    errorCode,
  });
  // RN-84: outras UFs e hosts fora da SEFAZ-PR ficam no fallback, sem buscar nada
  if (qr.uf !== NFCE_UF_PR || !isAllowedNfceHost(qr.url)) {
    return fallback('NFCE_UNAVAILABLE');
  }
  const url = rebuildNfceUrl(qr, deps.baseUrl);
  if (!url) {
    return fallback('NFCE_UNAVAILABLE');
  }
  const baseHost = hostOf(deps.baseUrl);
  const allowed = (u: string) =>
    isAllowedNfceHost(u) || (baseHost !== null && hostOf(u) === baseHost);
  let html: string | null = null;
  let last: NfceErrorCode = 'NFCE_UNAVAILABLE';
  for (let tryNo = 0; tryNo < 2 && html === null; tryNo += 1) {
    try {
      html = await attempt(url, deps, allowed);
    } catch (error) {
      last = error instanceof Fallback ? error.code : 'NFCE_UNAVAILABLE';
      if (!retriable(error)) {
        break;
      }
    }
  }
  if (html === null) {
    return fallback(last);
  }
  const parsed = parseNfcePage(html);
  if (parsed.status === 'fallback') {
    return fallback(parsed.errorCode);
  }
  return { status: 'full', qr, receipt: parsed.receipt };
}

/** `nfce-fetch` `{ qr }` → `{ status, qr, receipt, errorCode? }`; QR inválido → 400. */
export async function handleNfceFetch(request: Request, deps: NfceDeps): Promise<Response> {
  const early = preflight(request, deps.cors);
  if (early) {
    return early;
  }
  try {
    if (request.method !== 'POST') {
      throw new AppError('METHOD_NOT_ALLOWED');
    }
    const caller = await requireCaller(request, deps.caller);
    const raw = (await readJson(request)) as { qr?: unknown } | null;
    if (typeof raw?.qr !== 'string' || raw.qr.length === 0 || raw.qr.length > 1000) {
      throw new AppError('BAD_REQUEST', 'qr é obrigatório.');
    }
    let qr: NfceQr;
    try {
      qr = parseNfceQr(raw.qr);
    } catch (error) {
      if (error instanceof DomainError) {
        throw new AppError('BAD_REQUEST', 'QR da NFC-e inválido.');
      }
      throw error;
    }
    await enforceRate(caller, 'nfce-fetch');
    return jsonResponse(await fetchNfce(qr, deps), request, deps.cors);
  } catch (error) {
    return handleError(error, request, deps.cors);
  }
}
