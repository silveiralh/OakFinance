// Variáveis públicas do build (tech §9.8), validadas com zod. Só entram aqui valores públicos por natureza:
// nenhum segredo chega ao front (tech §7.1).
import { z } from 'zod';

declare global {
  /** Versão do app (package.json + SHA curto do commit no CI), definida no vite.config.ts. */
  const __APP_VERSION__: string;
}

export const APP_ENVS = ['production', 'staging', 'preview', 'local'] as const;
export type AppEnvName = (typeof APP_ENVS)[number];

/** Supabase local (CLI), usado nos ambientes `local` e no E2E quando o build não recebe a URL. */
export const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';

const blankToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(blankToUndefined, z.string().trim().optional());

const RawEnv = z.object({
  VITE_APP_ENV: z.preprocess(blankToUndefined, z.enum(APP_ENVS).default('local')),
  VITE_SUPABASE_URL: z.preprocess(blankToUndefined, z.url({ protocol: /^https?$/ }).optional()),
  VITE_SUPABASE_PUBLISHABLE_KEY: optionalText,
  VITE_VAPID_PUBLIC_KEY: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{80,100}$/, 'VITE_VAPID_PUBLIC_KEY deve ser base64url')
      .optional(),
  ),
  VITE_E2E: optionalText,
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
  const parsed = RawEnv.safeParse(raw);
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
