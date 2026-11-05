// QR da NFC-e (tech §5.10; RN-82, RN-84, RN-85). Só lê a URL do QR: a busca da página é da Edge Function.
import { DomainError } from '../errors.ts';
import type { Cents, YearMonth } from '../types.ts';

export interface NfceQr {
  url: string;
  accessKey: string;
  uf: string;
  issuedYearMonth: YearMonth;
  issuerCnpj: string;
  model: '65';
  series: string;
  number: string;
  emissionType: string;
  qrVersion: 2 | 3;
  env: 1 | 2;
  contingency: { day: number; totalCents: Cents } | null; // só emissões em contingência trazem valor
}

/** UF do Paraná no código do IBGE (RN-82). */
export const NFCE_UF_PR = '41';

/** Domínio da SEFAZ-PR: a página só é buscada em `*.fazenda.pr.gov.br` (RN-82). */
export const NFCE_PR_HOST_SUFFIX = 'fazenda.pr.gov.br';

const KEY_RE = /^\d{44}$/;

/** Dígito verificador da chave de acesso: módulo 11 com pesos 2..9 da direita para a esquerda. */
export function accessKeyCheckDigit(first43: string): number {
  if (!/^\d{43}$/.test(first43)) {
    throw new DomainError('INVALID_ARGUMENT', 'a chave sem DV deve ter 43 dígitos');
  }
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** Host aceito para buscar a página pública (allowlist da SEFAZ-PR, RN-82; demais → fallback RN-84). */
export function isNfceHostAllowed(url: string): boolean {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    host = parsed.hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === NFCE_PR_HOST_SUFFIX || host.endsWith(`.${NFCE_PR_HOST_SUFFIX}`);
}

function invalid(message: string): never {
  throw new DomainError('NFCE_QR_INVALID', message);
}

/** vNF do QR de contingência ("25.9", "1234.56") em centavos, sem ponto flutuante. */
function decimalToCents(value: string): Cents {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) {
    invalid('valor total do QR inválido');
  }
  const [, units = '0', fraction = ''] = match;
  return Number(units) * 100 + Number(fraction.padEnd(2, '0'));
}

function parseDay(value: string): number {
  if (!/^\d{1,2}$/.test(value)) {
    invalid('dia de emissão do QR inválido');
  }
  const day = Number(value);
  if (day < 1 || day > 31) {
    invalid('dia de emissão do QR inválido');
  }
  return day;
}

function parseEnv(value: string | undefined): 1 | 2 {
  if (value === '1') {
    return 1;
  }
  if (value === '2') {
    return 2;
  }
  return invalid('ambiente do QR inválido');
}

function extractP(raw: string): { url: string; p: string } {
  const text = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return invalid('o QR não é uma URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    invalid('o QR não é uma URL http(s)');
  }
  const p = parsed.searchParams.get('p');
  if (!p) {
    invalid('a URL do QR não tem o parâmetro p');
  }
  return { url: text, p: p.trim() };
}

/**
 * Lê a URL do QR da NFC-e (v2 e v3, online e em contingência).
 * Lança `NFCE_QR_INVALID` para formato desconhecido e `NFCE_KEY_DV` quando o dígito verificador não confere.
 * UF ≠ 41 e hosts fora da SEFAZ-PR são aceitos aqui: o fallback da RN-84 usa o que a chave traz.
 */
export function parseNfceQr(raw: string): NfceQr {
  const { url, p } = extractP(raw);
  const parts = p.split('|');
  const [accessKey = '', version, envRaw] = parts;
  if (!KEY_RE.test(accessKey)) {
    invalid('a chave de acesso deve ter 44 dígitos');
  }
  if (accessKeyCheckDigit(accessKey.slice(0, 43)) !== Number(accessKey[43])) {
    throw new DomainError('NFCE_KEY_DV', 'dígito verificador da chave de acesso não confere');
  }
  const model = accessKey.slice(20, 22);
  if (model !== '65') {
    invalid('a chave não é de NFC-e (modelo 65)');
  }
  const yy = accessKey.slice(2, 4);
  const mm = accessKey.slice(4, 6);
  const month = Number(mm);
  if (month < 1 || month > 12) {
    invalid('mês de emissão da chave inválido');
  }
  let qrVersion: 2 | 3;
  if (version === '2') {
    qrVersion = 2;
  } else if (version === '3') {
    qrVersion = 3;
  } else {
    return invalid('versão do QR desconhecida');
  }
  const env = parseEnv(envRaw);
  const rest = parts.slice(3);
  let contingency: NfceQr['contingency'] = null;
  if (qrVersion === 2) {
    // online: cIdToken|cHash · contingência: dia|vNF|digVal|cIdToken|cHash
    if (rest.length === 5) {
      contingency = { day: parseDay(rest[0] ?? ''), totalCents: decimalToCents(rest[1] ?? '') };
    } else if (rest.length !== 2) {
      invalid('quantidade de parâmetros do QR v2 inválida');
    }
  } else if (rest.length === 5) {
    // v3 contingência: dia|vNF|tpIdDest|idDest|assinatura
    contingency = { day: parseDay(rest[0] ?? ''), totalCents: decimalToCents(rest[1] ?? '') };
  } else if (rest.length !== 0) {
    invalid('quantidade de parâmetros do QR v3 inválida');
  }
  return {
    url,
    accessKey,
    uf: accessKey.slice(0, 2),
    issuedYearMonth: `20${yy}-${mm}`,
    issuerCnpj: accessKey.slice(6, 20),
    model: '65',
    series: accessKey.slice(22, 25),
    number: accessKey.slice(25, 34),
    emissionType: accessKey.slice(34, 35),
    qrVersion,
    env,
    contingency,
  };
}
