// Smoke do app publicado (T-036, job `smoke` do deploy.yml): confere, por HTTP, que a produção serve o shell, o
// fallback do SPA, a CSP com o Supabase real, o manifest e o Service Worker. Sem navegador: o job do deploy não
// instala o Playwright, e estes são os pontos que um deploy quebrado derruba.
//   node scripts/smoke-remote.ts            → SMOKE_URL ou https://oakfinance.pages.dev (endereço público, SETUP-08)
// Nunca imprime corpo de resposta; só o caminho, o status e o motivo.

export const DEFAULT_URL = 'https://oakfinance.pages.dev';
export const ATTEMPTS = 4;
export const RETRY_MS = 15_000;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface Check {
  path: string;
  verify: (response: Response) => Promise<string | null>;
}

const isHtml = (r: Response) => (r.headers.get('content-type') ?? '').includes('text/html');

async function shell(r: Response): Promise<string | null> {
  if (!isHtml(r)) {
    return 'não é HTML';
  }
  const body = await r.text();
  return body.includes('id="root"') && body.includes('OakFinance') ? null : 'sem o shell do app';
}

/** CSP de produção: existe, liga ao Supabase por https e não aponta para o Supabase local. */
export function cspProblem(csp: string | null): string | null {
  if (!csp) {
    return 'sem Content-Security-Policy';
  }
  const connect = /connect-src ([^;]+)/.exec(csp)?.[1] ?? '';
  if (!/https:\/\/[a-z0-9-]+\.supabase\.co\b/.test(connect)) {
    return 'connect-src sem o Supabase de produção';
  }
  if (/127\.0\.0\.1|localhost/.test(connect)) {
    return 'connect-src aponta para o Supabase local';
  }
  if (!/frame-ancestors 'none'/.test(csp)) {
    return "sem frame-ancestors 'none'";
  }
  return null;
}

export const CHECKS: readonly Check[] = [
  {
    path: '/',
    verify: async (r) => cspProblem(r.headers.get('content-security-policy')) ?? (await shell(r)),
  },
  { path: '/boas-vindas', verify: shell },
  { path: '/lancamentos', verify: shell },
  {
    path: '/manifest.webmanifest',
    verify: async (r) => {
      try {
        const manifest = (await r.json()) as { name?: string; start_url?: string };
        return manifest.name === 'OakFinance' && manifest.start_url ? null : 'manifest sem nome';
      } catch {
        return 'manifest inválido';
      }
    },
  },
  {
    path: '/sw.js',
    verify: async (r) =>
      (r.headers.get('content-type') ?? '').includes('javascript') ? null : 'sw.js sem JavaScript',
  },
];

/** Uma rodada de verificações. Devolve as falhas como "caminho: motivo". */
export async function checkOnce(fetcher: Fetcher, baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/+$/, '');
  const failures: string[] = [];
  for (const check of CHECKS) {
    let response: Response;
    try {
      response = await fetcher(`${base}${check.path}`, { redirect: 'follow' });
    } catch {
      failures.push(`${check.path}: falha de rede`);
      continue;
    }
    if (response.status !== 200) {
      failures.push(`${check.path}: HTTP ${response.status}`);
      continue;
    }
    const problem = await check.verify(response);
    if (problem) {
      failures.push(`${check.path}: ${problem}`);
    }
  }
  return failures;
}

/** Repete enquanto a publicação propaga (o Pages pode levar alguns segundos). */
export async function run(
  env: Record<string, string | undefined>,
  fetcher: Fetcher,
  log: (line: string) => void,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<number> {
  const url = env.SMOKE_URL || DEFAULT_URL;
  let failures: string[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    failures = await checkOnce(fetcher, url);
    if (failures.length === 0) {
      log(`smoke: ok (${CHECKS.length} verificações em ${url})`);
      return 0;
    }
    if (attempt < ATTEMPTS) {
      await wait(RETRY_MS);
    }
  }
  for (const failure of failures) {
    log(`smoke: ${failure}`);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.env, fetch, (line) => {
    console.log(line);
  });
}
