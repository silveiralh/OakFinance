// Keepalive e saúde do Supabase (tech §6.5 e §7.3), usado pelo keepalive.yml e pelo smoke do deploy.
//   node scripts/ops-check.ts ping    → POST /rest/v1/rpc/ping com a chave publicável (SUPABASE_URL, SUPABASE_KEY)
//   node scripts/ops-check.ts health  → POST /rest/v1/rpc/ops_health com a chave secreta (SUPABASE_URL, SUPABASE_KEY)
// Nunca imprime chaves nem respostas com dados; só o status e as contagens.

export interface Health {
  job_errors_24h: number;
  reminders_tick_age_minutes: number | null;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Idade máxima aceitável do último reminders-tick (o cron roda a cada 5 min; folga para atrasos). */
export const MAX_TICK_AGE_MINUTES = 30;

export function rpcUrl(baseUrl: string, fn: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`;
}

export async function callRpc(fetcher: Fetcher, baseUrl: string, key: string, fn: string) {
  return fetcher(rpcUrl(baseUrl, fn), {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

/**
 * A função `reminders-tick` só existe a partir da T-064. Antes disso o cron não tem o que chamar e o
 * `ops_health` sempre diz "nunca rodou", o que deixava o keepalive vermelho todo dia (issue #51). A T-064
 * passa esta constante para `true` junto com o deploy da função.
 */
export const REMINDERS_TICK_LIVE = false;

export function evaluateHealth(
  health: Health,
  { tickLive = REMINDERS_TICK_LIVE }: { tickLive?: boolean } = {},
): string[] {
  const problems: string[] = [];
  if (health.job_errors_24h > 0) {
    problems.push(`${health.job_errors_24h} job_runs com erro nas últimas 24 h`);
  }
  if (!tickLive) {
    return problems;
  }
  if (health.reminders_tick_age_minutes === null) {
    problems.push('reminders-tick nunca rodou');
  } else if (health.reminders_tick_age_minutes > MAX_TICK_AGE_MINUTES) {
    problems.push(`último reminders-tick há ${health.reminders_tick_age_minutes} min`);
  }
  return problems;
}

export async function run(
  mode: string | undefined,
  env: Record<string, string | undefined>,
  fetcher: Fetcher,
  log: (line: string) => void,
): Promise<number> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_KEY;
  if (mode !== 'ping' && mode !== 'health') {
    log('uso: ops-check.ts ping|health');
    return 2;
  }
  if (!url || !key) {
    log(`${mode}: SUPABASE_URL ou SUPABASE_KEY ausente`);
    return 1;
  }
  const fn = mode === 'ping' ? 'ping' : 'ops_health';
  let response: Response;
  try {
    response = await callRpc(fetcher, url, key, fn);
  } catch {
    log(`${mode}: falha de rede`);
    return 1;
  }
  if (response.status !== 200) {
    log(`${mode}: HTTP ${response.status}`);
    return 1;
  }
  if (mode === 'ping') {
    log('ping: 200');
    return 0;
  }
  const raw = (await response.json()) as Health | Health[];
  const health = Array.isArray(raw) ? raw[0] : raw;
  if (!health) {
    log('health: resposta vazia');
    return 1;
  }
  const problems = evaluateHealth(health);
  if (problems.length > 0) {
    log(`health: ${problems.join('; ')}`);
    return 1;
  }
  log('health: ok');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await run(process.argv[2], process.env, fetch, (line) => {
    console.log(line);
  });
}
