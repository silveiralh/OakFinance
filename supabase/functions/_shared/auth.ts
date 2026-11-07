// Auth 'secret' das funções chamadas pelo pg_cron (tech §6.0): `verify_jwt = false` no config.toml e a chave
// secreta do projeto no header `apikey` (vem do Vault, `cron_secret_key`). A chave enviada precisa ser uma das
// chaves secretas que a plataforma injeta na função; nunca é registrada em log.
import type { EnvReader } from './http.ts';

/** Chaves aceitas: as de `SUPABASE_SECRET_KEYS` (JSON `{ nome: chave }`) e a `SUPABASE_SERVICE_ROLE_KEY`. */
export function secretKeysFromEnv(env: EnvReader): string[] {
  const keys: string[] = [];
  const raw = env.get('SUPABASE_SECRET_KEYS')?.trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        for (const value of Object.values(parsed)) {
          if (typeof value === 'string' && value.trim() !== '') {
            keys.push(value.trim());
          }
        }
      }
    } catch {
      // formato inesperado: ignora
    }
  }
  const legacy = env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy) {
    keys.push(legacy);
  }
  return keys;
}

/** Chave apresentada na requisição: `apikey` ou `Authorization: Bearer`. */
export function presentedKey(request: Request): string | null {
  const apikey = request.headers.get('apikey')?.trim();
  if (apikey) {
    return apikey;
  }
  const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '');
  return match?.[1] ?? null;
}

/** Comparação em tempo constante para strings do mesmo tamanho. */
export function sameSecret(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < ea.length; i++) {
    diff |= (ea[i] as number) ^ (eb[i] as number);
  }
  return diff === 0;
}

/** A chave secreta válida enviada pela requisição, ou `null`. */
export function authorizedSecret(request: Request, keys: readonly string[]): string | null {
  const key = presentedKey(request);
  if (!key) {
    return null;
  }
  return keys.some((k) => sameSecret(k, key)) ? key : null;
}
