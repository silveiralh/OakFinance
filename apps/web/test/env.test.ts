import { describe, expect, it } from 'vitest';
import { EnvError, getEnv, LOCAL_SUPABASE_URL, parseEnv } from '../src/lib/env';

const VAPID = `B${'A'.repeat(86)}`;

describe('lib/env (tech §9.8)', () => {
  it('local sem variáveis: Supabase local e sem chaves', () => {
    expect(parseEnv({})).toEqual({
      appEnv: 'local',
      supabaseUrl: LOCAL_SUPABASE_URL,
      supabasePublishableKey: null,
      vapidPublicKey: null,
      e2e: false,
      version: '0.0.0-dev',
    });
  });

  it('produção completa: normaliza a URL e guarda a versão', () => {
    const env = parseEnv(
      {
        VITE_APP_ENV: 'production',
        VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_exemplo',
        VITE_VAPID_PUBLIC_KEY: VAPID,
      },
      '1.2.3+abc1234',
    );
    expect(env.supabaseUrl).toBe('https://abcdefghijklmnopqrst.supabase.co');
    expect(env.vapidPublicKey).toBe(VAPID);
    expect(env.version).toBe('1.2.3+abc1234');
  });

  it('valores vazios contam como ausentes (variáveis do CI ainda não configuradas)', () => {
    expect(() =>
      parseEnv({
        VITE_APP_ENV: 'staging',
        VITE_SUPABASE_URL: '',
        VITE_SUPABASE_PUBLISHABLE_KEY: '',
      }),
    ).toThrow(/VITE_SUPABASE_URL ausente/);
    expect(parseEnv({ VITE_APP_ENV: '', VITE_E2E: '' }).appEnv).toBe('local');
  });

  it('fora de local: chave publicável obrigatória e URL https', () => {
    expect(() =>
      parseEnv({ VITE_APP_ENV: 'preview', VITE_SUPABASE_URL: 'https://x.supabase.co' }),
    ).toThrow(/PUBLISHABLE_KEY/);
    expect(() =>
      parseEnv({
        VITE_APP_ENV: 'staging',
        VITE_SUPABASE_URL: 'http://x.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_exemplo',
      }),
    ).toThrow(/https/);
  });

  it('E2E aceita o Supabase local mesmo com outro ambiente', () => {
    const env = parseEnv({ VITE_APP_ENV: 'staging', VITE_E2E: '1' });
    expect(env.e2e).toBe(true);
    expect(env.supabaseUrl).toBe(LOCAL_SUPABASE_URL);
  });

  it('recusa ambiente desconhecido, URL inválida e VAPID fora de base64url', () => {
    expect(() => parseEnv({ VITE_APP_ENV: 'dev' })).toThrow(EnvError);
    expect(() => parseEnv({ VITE_SUPABASE_URL: 'ftp://x' })).toThrow(/VITE_SUPABASE_URL/);
    expect(() => parseEnv({ VITE_VAPID_PUBLIC_KEY: 'curta+/' })).toThrow(/VITE_VAPID_PUBLIC_KEY/);
  });

  it('getEnv lê o ambiente do build uma vez', () => {
    const env = getEnv();
    expect(env).toBe(getEnv());
    expect(env.appEnv).toBe('local');
  });
});
