import { describe, expect, it, vi } from 'vitest';
import { CHECKS, checkOnce, cspProblem, DEFAULT_URL, type Fetcher, run } from './smoke-remote.ts';

const CSP =
  "default-src 'self'; connect-src 'self' https://ref.supabase.co wss://ref.supabase.co; frame-ancestors 'none'";
const SHELL = '<!doctype html><title>OakFinance</title><div id="root"></div>';

function site(overrides: Record<string, Response> = {}): Fetcher {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (overrides[path]) {
      return overrides[path];
    }
    if (path === '/manifest.webmanifest') {
      return Response.json({ name: 'OakFinance', start_url: '/' });
    }
    if (path === '/sw.js') {
      return new Response('self.x=1', { headers: { 'content-type': 'application/javascript' } });
    }
    return new Response(SHELL, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP },
    });
  });
}

const noWait = async () => undefined;

describe('smoke remoto (T-036)', () => {
  it('US-05: produção saudável passa em uma rodada, no endereço público padrão', async () => {
    const lines: string[] = [];
    const f = site();
    expect(await run({}, f, (l) => lines.push(l), noWait)).toBe(0);
    expect(lines).toEqual([`smoke: ok (${CHECKS.length} verificações em ${DEFAULT_URL})`]);
    expect(f).toHaveBeenCalledWith(`${DEFAULT_URL}/boas-vindas`, { redirect: 'follow' });
  });

  it('CSP de produção: exige o Supabase real por https e recusa o local', () => {
    expect(cspProblem(CSP)).toBeNull();
    expect(cspProblem(null)).toBe('sem Content-Security-Policy');
    expect(cspProblem("connect-src 'self' http://127.0.0.1:54321; frame-ancestors 'none'")).toBe(
      'connect-src sem o Supabase de produção',
    );
    expect(
      cspProblem(
        "connect-src https://a.supabase.co http://127.0.0.1:54321; frame-ancestors 'none'",
      ),
    ).toBe('connect-src aponta para o Supabase local');
    expect(cspProblem('connect-src https://a.supabase.co')).toBe("sem frame-ancestors 'none'");
  });

  it('aponta o caminho e o motivo de cada falha, sem o corpo da resposta', async () => {
    const failures = await checkOnce(
      site({
        '/lancamentos': new Response('nada', { status: 404 }),
        '/sw.js': new Response('<html>', { headers: { 'content-type': 'text/html' } }),
        '/manifest.webmanifest': new Response('{', { status: 200 }),
        '/boas-vindas': new Response('{}', { headers: { 'content-type': 'application/json' } }),
      }),
      'https://app.example.test/',
    );
    expect(failures).toEqual([
      '/boas-vindas: não é HTML',
      '/lancamentos: HTTP 404',
      '/manifest.webmanifest: manifest inválido',
      '/sw.js: sw.js sem JavaScript',
    ]);
  });

  it('repete enquanto o Pages propaga e falha depois das tentativas, com falha de rede', async () => {
    let calls = 0;
    const flaky: Fetcher = async (url, init) => {
      calls += 1;
      if (calls <= CHECKS.length) {
        throw new Error('rede');
      }
      return site()(url, init);
    };
    const wait = vi.fn(noWait);
    expect(await run({ SMOKE_URL: 'https://app.example.test' }, flaky, () => undefined, wait)).toBe(
      0,
    );
    expect(wait).toHaveBeenCalledTimes(1);

    const lines: string[] = [];
    const down: Fetcher = async () => {
      throw new Error('rede');
    };
    expect(await run({}, down, (l) => lines.push(l), noWait)).toBe(1);
    expect(lines).toContain('smoke: /: falha de rede');
    const empty = await checkOnce(
      site({
        '/': new Response('<p>x</p>', {
          headers: { 'content-type': 'text/html', 'content-security-policy': CSP },
        }),
      }),
      DEFAULT_URL,
    );
    expect(empty).toEqual(['/: sem o shell do app']);
    expect(
      await checkOnce(
        site({ '/manifest.webmanifest': Response.json({ name: 'Outro' }) }),
        DEFAULT_URL,
      ),
    ).toEqual(['/manifest.webmanifest: manifest sem nome']);
  });
});
