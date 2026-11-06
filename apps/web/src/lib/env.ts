// Variáveis públicas do build (tech §9.8), validadas com zod (`zod/mini`, para caber no bundle inicial). Só
// entram aqui valores públicos por natureza: nenhum segredo chega ao front (tech §7.1).
import * as z from 'zod/mini';

// Sem JIT: a CSP (tech §7.1) não tem 'unsafe-eval', e a sonda de `new Function` do zod gera
// `securitypolicyviolation` (E14). Vale para todo o app (configuração global do núcleo do zod).
z.config({ jitless: true });

declare global {
  /** Versão do app (package.json + SHA curto do commit no CI), definida no vite.config.ts. */
  const __APP_VERSION__: string;
}

export const APP_ENVS = ['production', 'staging', 'preview', 'local'] as const;
export type AppEnvName = (typeof APP_ENVS)[number];

/** Supabase local (CLI), usado nos ambientes `local` e no E2E quando o build não recebe a URL. */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

const KEYS = [
  'VITE_APP_ENV',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_VAPID_PUBLIC_KEY',
  'VITE_E2E',
] as const;

/** Texto vazio (variável do CI ainda não configurada) conta como ausente; o resto é aparado. */
function normalize(raw: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value = raw[key];
    const text = typeof value === 'string' ? value.trim() : value;
    if (text !== undefined && text !== '') {
      out[key] = text;
    }
  }
  return out;
}

const RawEnv = z.object({
  VITE_APP_ENV: z._default(z.enum(APP_ENVS), 'local'),
  VITE_SUPABASE_URL: z.optional(z.url({ protocol: /^https?$/ })),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.optional(z.string()),
  VITE_VAPID_PUBLIC_KEY: z.optional(z.string().check(z.regex(/^[A-Za-z0-9_-]{80,100}$/))),
  VITE_E2E: z.optional(z.string()),
});

export interface AppEnv {
  appEnv: AppEnvName;
  supabaseUrl: string;
  supabasePublishableKey: string | null;
  vapidPublicKey: string | null;
  e2e: boolean;
  version: string;
}

export class EnvError extends Error {
  override name = 'EnvError';
}

/**
 * Valida e normaliza o ambiente. Fora de `local` e do E2E, a URL e a chave publicável do Supabase são
 * obrigatórias e a URL precisa ser https.
 */
export function parseEnv(raw: Readonly<Record<string, unknown>>, version = '0.0.0-dev'): AppEnv {
  const parsed = RawEnv.safeParse(normalize(raw));
  if (!parsed.success) {
    throw new EnvError(
      `Ambiente inválido: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }
  const data = parsed.data;
  const e2e = data.VITE_E2E === '1';
  const relaxed = data.VITE_APP_ENV === 'local' || e2e;
  const supabaseUrl = data.VITE_SUPABASE_URL ?? (relaxed ? LOCAL_SUPABASE_URL : null);
  if (supabaseUrl === null) {
    throw new EnvError(`VITE_SUPABASE_URL ausente em ${data.VITE_APP_ENV}`);
  }
  if (!relaxed && !supabaseUrl.startsWith('https://')) {
    throw new EnvError(`VITE_SUPABASE_URL precisa ser https em ${data.VITE_APP_ENV}`);
  }
  if (!relaxed && !data.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new EnvError(`VITE_SUPABASE_PUBLISHABLE_KEY ausente em ${data.VITE_APP_ENV}`);
  }
  return {
    appEnv: data.VITE_APP_ENV,
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabasePublishableKey: data.VITE_SUPABASE_PUBLISHABLE_KEY ?? null,
    vapidPublicKey: data.VITE_VAPID_PUBLIC_KEY ?? null,
    e2e,
    version,
  };
}

let cached: AppEnv | null = null;

/** Ambiente do build atual (lido uma vez). */
export function getEnv(): AppEnv {
  cached ??= parseEnv(
    import.meta.env,
    typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev',
  );
  return cached;
}
