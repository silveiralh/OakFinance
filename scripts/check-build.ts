// Verificações do build de produção (tech §8.6, job `build`):
// - nenhum segredo nem o formulário de login de E2E em dist/;
// - orçamento: JS inicial ≤ 250 KB gzip, precache ≤ 3 MB, .wasm fora do bundle inicial;
// - manifest, sw.js e _headers quando o PWA existir (REQUIRE_PWA, ligado desde a T-030).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Ligado na T-030 (vite-plugin-pwa): exige manifest, sw.js e _headers com CSP. */
export const REQUIRE_PWA = true;

export const FORBIDDEN_IN_DIST = [
  'sb_secret_',
  'service_role',
  'PLUGGY_',
  'VAPID_PRIVATE',
  'data-e2e-login',
] as const;

export const INITIAL_JS_BUDGET = 250 * 1024;
export const PRECACHE_BUDGET = 3 * 1024 * 1024;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

export function scanForbidden(dist: string): string[] {
  const problems: string[] = [];
  for (const file of walk(dist)) {
    if (!/\.(js|mjs|css|html|json|webmanifest|txt|map)$|_headers$|_redirects$/.test(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const needle of FORBIDDEN_IN_DIST) {
      if (text.includes(needle)) {
        problems.push(`${relative(dist, file)} contém "${needle}"`);
      }
    }
  }
  return problems;
}

/** Scripts carregados de início: <script src> e <link rel="modulepreload"> do index.html. */
export function initialScripts(indexHtml: string): string[] {
  const urls = new Set<string>();
  for (const match of indexHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    urls.add(match[1] ?? '');
  }
  for (const match of indexHtml.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) {
    urls.add(match[1] ?? '');
  }
  return [...urls].filter((url) => url && !/^https?:/.test(url));
}

export function gzipSize(path: string): number {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

export function checkBudget(dist: string): { problems: string[]; initialJs: number } {
  const problems: string[] = [];
  const index = join(dist, 'index.html');
  if (!existsSync(index)) {
    return { problems: ['dist/index.html ausente'], initialJs: 0 };
  }
  const html = readFileSync(index, 'utf8');
  let initialJs = 0;
  for (const url of initialScripts(html)) {
    const file = join(dist, url.replace(/^\//, ''));
    if (!existsSync(file)) {
      problems.push(`script inicial ausente: ${url}`);
      continue;
    }
    if (url.endsWith('.wasm')) {
      problems.push(`.wasm no bundle inicial: ${url}`);
    }
    initialJs += gzipSize(file);
  }
  if (/\.wasm/.test(html)) {
    problems.push('.wasm referenciado no index.html (deve ficar fora do bundle inicial)');
  }
  if (initialJs > INITIAL_JS_BUDGET) {
    problems.push(
      `JS inicial ${(initialJs / 1024).toFixed(1)} KB gzip excede ${INITIAL_JS_BUDGET / 1024} KB`,
    );
  }
  return { problems, initialJs };
}

/** Soma do precache declarado no sw.js (entradas `url` do manifesto do Workbox). */
export function precacheBytes(dist: string): number {
  const sw = join(dist, 'sw.js');
  if (!existsSync(sw)) {
    return 0;
  }
  const text = readFileSync(sw, 'utf8');
  let total = 0;
  for (const match of text.matchAll(/"?url"?:\s*"([^"]+)"/g)) {
    const file = join(dist, (match[1] ?? '').replace(/^\//, ''));
    if (existsSync(file)) {
      total += statSync(file).size;
    }
  }
  return total;
}

interface Manifest {
  name?: string;
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  icons?: { sizes?: string; purpose?: string }[];
}

export function checkPwa(dist: string): string[] {
  const problems: string[] = [];
  const manifestPath = join(dist, 'manifest.webmanifest');
  if (!existsSync(manifestPath)) {
    problems.push('manifest.webmanifest ausente');
  } else {
    let manifest: Manifest = {};
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    } catch {
      problems.push('manifest.webmanifest não é JSON válido');
    }
    for (const key of ['name', 'id', 'start_url', 'scope'] as const) {
      if (!manifest[key]) {
        problems.push(`manifest sem "${key}"`);
      }
    }
    if (manifest.display !== 'standalone') {
      problems.push('manifest sem display: standalone');
    }
    const icons = manifest.icons ?? [];
    for (const size of ['192x192', '512x512']) {
      if (!icons.some((icon) => icon.sizes?.split(' ').includes(size))) {
        problems.push(`manifest sem ícone ${size}`);
      }
    }
    if (!icons.some((icon) => icon.purpose?.includes('maskable'))) {
      problems.push('manifest sem ícone maskable');
    }
  }
  if (!existsSync(join(dist, 'sw.js'))) {
    problems.push('sw.js ausente');
  }
  const headers = join(dist, '_headers');
  if (!existsSync(headers) || !readFileSync(headers, 'utf8').includes('Content-Security-Policy')) {
    problems.push('_headers ausente ou sem Content-Security-Policy');
  }
  const precache = precacheBytes(dist);
  if (precache > PRECACHE_BUDGET) {
    problems.push(`precache ${(precache / 1024 / 1024).toFixed(2)} MB excede 3 MB`);
  }
  return problems;
}

export function checkBuild(dist: string, requirePwa = REQUIRE_PWA): string[] {
  if (!existsSync(dist)) {
    return [`${dist} não existe: rode o build antes`];
  }
  const problems = [...scanForbidden(dist), ...checkBudget(dist).problems];
  if (requirePwa) {
    problems.push(...checkPwa(dist));
  }
  return problems;
}

export function main(dist: string): number {
  const problems = checkBuild(dist);
  if (problems.length > 0) {
    console.error('check-build: reprovado');
    for (const problem of problems) {
      console.error(`  ${problem}`);
    }
    return 1;
  }
  const { initialJs } = checkBudget(dist);
  console.log(
    `check-build: ok (JS inicial ${(initialJs / 1024).toFixed(1)} KB gzip${REQUIRE_PWA ? '' : '; PWA pendente T-030'})`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  process.exitCode = main(process.argv[2] ?? join(root, 'apps/web/dist'));
}
