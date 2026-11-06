// Gera o `_headers` do Cloudflare Pages (tech §7.1) a partir de `apps/web/_headers.template`, trocando
// `SUPABASE_HOST` pelo host de `VITE_SUPABASE_URL`. O build do app (plugin em `apps/web/vite.config.ts`) chama
// `buildHeaders` e grava `dist/_headers`; o `vite preview` aplica as mesmas regras (E14 com a CSP de verdade).
// Uso avulso: `node scripts/gen-headers.ts [saída]` (padrão: apps/web/dist/_headers).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST_PLACEHOLDER = 'SUPABASE_HOST';
/** Supabase local (CLI): usado quando o build não recebe `VITE_SUPABASE_URL` (E2E, CI sem SETUP-09). */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

export interface HeaderRule {
  path: string;
  headers: Array<[string, string]>;
}

/** URL do Supabase do build. Produção sem a variável é erro; os demais ambientes caem no Supabase local. */
export function resolveSupabaseUrl(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env.VITE_SUPABASE_URL?.trim() ?? '';
  if (raw === '') {
    if (env.VITE_APP_ENV === 'production') {
      throw new Error('gen-headers: VITE_SUPABASE_URL vazio no build de produção');
    }
    return LOCAL_SUPABASE_URL;
  }
  return raw;
}

/**
 * Troca `https://SUPABASE_HOST` e `wss://SUPABASE_HOST` pelo host real. Com URL `http:` (Supabase local) os
 * esquemas viram `http:` e `ws:`; em qualquer outro caso o template fica literal.
 */
export function renderHeaders(template: string, supabaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    throw new Error(`gen-headers: VITE_SUPABASE_URL inválida: ${supabaseUrl}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`gen-headers: esquema não suportado em VITE_SUPABASE_URL: ${url.protocol}`);
  }
  const secure = url.protocol === 'https:';
  return template
    .replaceAll(`https://${HOST_PLACEHOLDER}`, `${secure ? 'https' : 'http'}://${url.host}`)
    .replaceAll(`wss://${HOST_PLACEHOLDER}`, `${secure ? 'wss' : 'ws'}://${url.host}`);
}

/** Lê o formato do `_headers` (linha de caminho sem recuo; cabeçalhos recuados `Nome: valor`). */
export function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }
    if (!/^\s/.test(line)) {
      current = { path: line.trim(), headers: [] };
      rules.push(current);
      continue;
    }
    const separator = line.indexOf(':');
    if (!current || separator < 0) {
      throw new Error(`gen-headers: linha inválida: ${line.trim()}`);
    }
    current.headers.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
  }
  return rules;
}

function pathMatches(pattern: string, pathname: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(pathname);
}

/** Cabeçalhos de um caminho: como no Pages, todas as regras que casam se somam, na ordem do arquivo. */
export function headersFor(rules: readonly HeaderRule[], pathname: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (pathMatches(rule.path, pathname)) {
      for (const [name, value] of rule.headers) {
        out[name] = value;
      }
    }
  }
  return out;
}

/**
 * Ajuste só do `vite preview` (http://localhost): tira `upgrade-insecure-requests` e o HSTS, que não fazem
 * sentido sem TLS. As demais diretivas da CSP ficam iguais às de produção.
 */
export function forLocalPreview(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'strict-transport-security') {
      continue;
    }
    out[name] =
      name.toLowerCase() === 'content-security-policy'
        ? value
            .split(';')
            .map((directive) => directive.trim())
            .filter((directive) => directive !== '' && directive !== 'upgrade-insecure-requests')
            .join('; ')
        : value;
  }
  return out;
}

const root = fileURLToPath(new URL('..', import.meta.url));
export const TEMPLATE_PATH = join(root, 'apps/web/_headers.template');

/** Conteúdo final do `_headers` para o ambiente do build. */
export function buildHeaders(env: Readonly<Record<string, string | undefined>>): string {
  return renderHeaders(readFileSync(TEMPLATE_PATH, 'utf8'), resolveSupabaseUrl(env));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? join(root, 'apps/web/dist/_headers');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildHeaders(process.env));
  console.log(`gen-headers: ${out}`);
}
