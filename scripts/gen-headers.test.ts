import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildHeaders,
  forLocalPreview,
  headersFor,
  LOCAL_SUPABASE_URL,
  parseHeaders,
  renderHeaders,
  resolveSupabaseUrl,
  TEMPLATE_PATH,
} from './gen-headers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const template = readFileSync(TEMPLATE_PATH, 'utf8');

/** Bloco literal do `_headers` na tech §7.1 [CONTRATO]. */
function specHeaders(): string {
  const tech = readFileSync(join(root, 'docs/specs/02-tech-spec.md'), 'utf8');
  const section = tech.slice(tech.indexOf('### 7.1 '), tech.indexOf('### 7.2 '));
  const match = /`apps\/web\/public\/_headers`[^\n]*\n\n```\n([\s\S]*?)```/.exec(section);
  if (!match?.[1]) {
    throw new Error('bloco do _headers não encontrado na tech §7.1');
  }
  return match[1];
}

const csp = (text: string) => headersFor(parseHeaders(text), '/')['Content-Security-Policy'] ?? '';

describe('gen-headers (tech §7.1)', () => {
  it('o template é igual, linha a linha, ao bloco da tech §7.1', () => {
    expect(template).toBe(specHeaders());
  });

  it('troca SUPABASE_HOST pelo host https e wss do projeto', () => {
    const out = renderHeaders(template, 'https://abcdefghijklmnopqrst.supabase.co');
    expect(out).not.toContain('SUPABASE_HOST');
    expect(csp(out)).toContain(
      "connect-src 'self' https://abcdefghijklmnopqrst.supabase.co wss://abcdefghijklmnopqrst.supabase.co https://*.pluggy.ai;",
    );
  });

  it('Supabase local em http vira http e ws, com a porta', () => {
    expect(csp(renderHeaders(template, LOCAL_SUPABASE_URL))).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321 https://*.pluggy.ai;",
    );
  });

  it('recusa URL inválida ou com outro esquema', () => {
    expect(() => renderHeaders(template, 'não é url')).toThrow(/inválida/);
    expect(() => renderHeaders(template, 'ftp://x.example.test')).toThrow(/esquema/);
  });

  it('sem VITE_SUPABASE_URL: produção falha, os demais usam o Supabase local', () => {
    expect(() => resolveSupabaseUrl({ VITE_APP_ENV: 'production', VITE_SUPABASE_URL: '' })).toThrow(
      /produção/,
    );
    expect(resolveSupabaseUrl({ VITE_APP_ENV: 'staging', VITE_SUPABASE_URL: ' ' })).toBe(
      LOCAL_SUPABASE_URL,
    );
    expect(resolveSupabaseUrl({})).toBe(LOCAL_SUPABASE_URL);
    expect(resolveSupabaseUrl({ VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBe(
      'https://x.supabase.co',
    );
  });

  it('buildHeaders lê o template e aplica o ambiente', () => {
    const out = buildHeaders({ VITE_SUPABASE_URL: 'https://x.supabase.co' });
    expect(out).toContain('wss://x.supabase.co');
    expect(out.split('\n')[0]).toBe('/*');
  });

  it('parseHeaders lê caminhos e cabeçalhos e rejeita linha sem regra', () => {
    const rules = parseHeaders(template);
    expect(rules.map((rule) => rule.path)).toEqual([
      '/*',
      '/index.html',
      '/sw.js',
      '/manifest.webmanifest',
      '/assets/*',
    ]);
    expect(rules[0]?.headers.map(([name]) => name)).toEqual([
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
      'Cross-Origin-Opener-Policy',
    ]);
    expect(() => parseHeaders('  X-Solto: 1')).toThrow(/inválida/);
    expect(parseHeaders('# comentário\n\n/a\n  X: 1')).toEqual([
      { path: '/a', headers: [['X', '1']] },
    ]);
  });

  it('headersFor soma as regras que casam, como no Pages', () => {
    const rules = parseHeaders(template);
    const index = headersFor(rules, '/index.html');
    expect(index['Cache-Control']).toBe('no-cache');
    expect(index['X-Content-Type-Options']).toBe('nosniff');
    expect(headersFor(rules, '/assets/index-abc.js')['Cache-Control']).toBe(
      'public, max-age=31536000, immutable',
    );
    expect(headersFor(rules, '/lancamentos')['Cache-Control']).toBeUndefined();
    expect(headersFor(rules, '/sw.jsx')['Cache-Control']).toBeUndefined();
  });

  it('a CSP proíbe script inline, frames de terceiros e objetos', () => {
    const policy = csp(template);
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval' https://connect.pluggy.ai;");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
  });

  it('preview local: sem upgrade-insecure-requests e sem HSTS, o resto igual', () => {
    const headers = headersFor(parseHeaders(renderHeaders(template, LOCAL_SUPABASE_URL)), '/');
    const local = forLocalPreview(headers);
    expect(local['Strict-Transport-Security']).toBeUndefined();
    expect(local['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    expect(local['Content-Security-Policy']).toContain("object-src 'none'");
    expect(local['X-Content-Type-Options']).toBe('nosniff');
    expect(Object.keys(local)).toHaveLength(Object.keys(headers).length - 1);
  });
});
