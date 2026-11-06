// Build do E2E (VITE_E2E=1). Quando o Supabase local está de pé (job e2e do CI), lê a URL e a chave publicável de
// `supabase status -o env` e passa ao build, sem imprimir. Sem o Supabase, o build sai sem cliente (só as telas).
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const app = fileURLToPath(new URL('..', import.meta.url));

export function parseStatusEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z_]+)="?([^"]*)"?$/.exec(line.trim());
    if (match) {
      out[match[1]] = match[2];
    }
  }
  return out;
}

const env = { ...process.env, VITE_E2E: '1' };
try {
  const status = parseStatusEnv(
    execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  );
  const key = status.PUBLISHABLE_KEY || status.ANON_KEY;
  if (status.API_URL && key) {
    env.VITE_SUPABASE_URL = status.API_URL;
    env.VITE_SUPABASE_PUBLISHABLE_KEY = key;
    console.log('build-e2e: usando o Supabase local');
  }
} catch {
  console.warn('build-e2e: Supabase local indisponível; build sem cliente');
}

const result = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: app, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
