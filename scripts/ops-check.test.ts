import { describe, expect, it, vi } from 'vitest';
import { evaluateHealth, type Fetcher, rpcUrl, run } from './ops-check.ts';

const env = { SUPABASE_URL: 'https://ref.example.test/', SUPABASE_KEY: 'chave-de-teste' };

function fetcher(status: number, body: unknown = null): Fetcher {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

async function exec(mode: string | undefined, f: Fetcher, e: Record<string, string> = env) {
  const lines: string[] = [];
  const code = await run(mode, e, f, (line) => lines.push(line));
  return { code, lines };
}

describe('ops-check', () => {
  it('monta a URL da RPC sem barra dupla', () => {
    expect(rpcUrl('https://ref.example.test/', 'ping')).toBe(
      'https://ref.example.test/rest/v1/rpc/ping',
    );
  });

  it('ping 200 passa e envia a chave nos cabeçalhos, sem imprimi-la', async () => {
    const f = fetcher(200, '2026-11-05T00:00:00Z');
    const { code, lines } = await exec('ping', f);
    expect(code).toBe(0);
    expect(f).toHaveBeenCalledWith(
      'https://ref.example.test/rest/v1/rpc/ping',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'chave-de-teste' }),
      }),
    );
    expect(lines.join('\n')).not.toContain('chave-de-teste');
  });

  it('ping diferente de 200 falha', async () => {
    expect((await exec('ping', fetcher(503))).code).toBe(1);
  });

  it('falha de rede falha sem detalhes', async () => {
    const f: Fetcher = async () => {
      throw new Error('ECONNREFUSED chave-de-teste');
    };
    const { code, lines } = await exec('ping', f);
    expect(code).toBe(1);
    expect(lines).toEqual(['ping: falha de rede']);
  });

  it('health ok, com erros de job e com tick atrasado', async () => {
    expect(
      (await exec('health', fetcher(200, [{ job_errors_24h: 0, reminders_tick_age_minutes: 4 }])))
        .code,
    ).toBe(0);
    const failing = await exec(
      'health',
      fetcher(200, { job_errors_24h: 2, reminders_tick_age_minutes: 90 }),
    );
    expect(failing.code).toBe(1);
    expect(failing.lines[0]).toContain('2 job_runs com erro');
    expect((await exec('health', fetcher(200, []))).code).toBe(1);
  });

  it('evaluateHealth: tick nunca rodou', () => {
    expect(evaluateHealth({ job_errors_24h: 0, reminders_tick_age_minutes: null })).toEqual([
      'reminders-tick nunca rodou',
    ]);
  });

  it('modo inválido e variáveis ausentes', async () => {
    expect((await exec(undefined, fetcher(200))).code).toBe(2);
    expect((await exec('ping', fetcher(200), {})).code).toBe(1);
  });
});
