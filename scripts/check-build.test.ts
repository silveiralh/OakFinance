import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkBudget,
  checkBuild,
  checkPwa,
  initialScripts,
  main,
  precacheBytes,
  REQUIRE_PWA,
  scanForbidden,
} from './check-build.ts';

let dist: string;

function write(path: string, content: string | Buffer): void {
  const full = join(dist, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

function validPwa(): void {
  write(
    'manifest.webmanifest',
    JSON.stringify({
      name: 'OakFinance',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      icons: [
        { sizes: '192x192' },
        { sizes: '512x512' },
        { sizes: '512x512', purpose: 'maskable' },
      ],
    }),
  );
  write('sw.js', 'precache([{url:"assets/app.js",revision:null}])');
  write('_headers', "/*\n  Content-Security-Policy: default-src 'self'\n");
}

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), 'dist-'));
  write(
    'index.html',
    '<script type="module" crossorigin src="/assets/app.js"></script><link rel="modulepreload" href="/assets/vendor.js">',
  );
  write('assets/app.js', 'console.info("app")');
  write('assets/vendor.js', 'export const v = 1;');
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('check-build', () => {
  it('build limpo passa (com o PWA exigido desde a T-030)', () => {
    expect(REQUIRE_PWA).toBe(true);
    validPwa();
    expect(checkBuild(dist)).toEqual([]);
    expect(main(dist)).toBe(0);
  });

  it('dist ausente reprova', () => {
    expect(checkBuild(join(dist, 'nao-existe'))).toHaveLength(1);
  });

  it.each(['sb_secret_', 'service_role', 'PLUGGY_', 'VAPID_PRIVATE', 'data-e2e-login'])(
    'reprova "%s" em dist/',
    (needle) => {
      write('assets/chunk.js', `const x = "${needle}abc";`);
      expect(scanForbidden(dist)).toEqual([`assets/chunk.js contém "${needle}"`]);
      expect(main(dist)).toBe(1);
    },
  );

  it('lê scripts iniciais do index.html', () => {
    expect(
      initialScripts(
        '<script src="/a.js"></script><link rel="modulepreload" href="/b.js"><script src="https://x.example.com/c.js"></script>',
      ),
    ).toEqual(['/a.js', '/b.js']);
  });

  it('reprova JS inicial acima de 250 KB gzip', () => {
    write('assets/app.js', randomBytes(300 * 1024));
    const { problems, initialJs } = checkBudget(dist);
    expect(initialJs).toBeGreaterThan(250 * 1024);
    expect(problems[0]).toMatch(/excede 250 KB/);
  });

  it('reprova .wasm no bundle inicial e script ausente', () => {
    write(
      'index.html',
      '<script src="/assets/qr.wasm"></script><script src="/assets/x.js"></script>',
    );
    write('assets/qr.wasm', 'wasm');
    const { problems } = checkBudget(dist);
    expect(problems).toEqual(
      expect.arrayContaining([
        '.wasm no bundle inicial: /assets/qr.wasm',
        'script inicial ausente: /assets/x.js',
        '.wasm referenciado no index.html (deve ficar fora do bundle inicial)',
      ]),
    );
  });

  it('index.html ausente reprova', () => {
    rmSync(join(dist, 'index.html'));
    expect(checkBudget(dist).problems).toEqual(['dist/index.html ausente']);
  });

  it('PWA completo passa e precache é somado', () => {
    validPwa();
    expect(checkPwa(dist)).toEqual([]);
    expect(precacheBytes(dist)).toBeGreaterThan(0);
    expect(checkBuild(dist, true)).toEqual([]);
  });

  it('PWA incompleto reprova cada item', () => {
    write('manifest.webmanifest', JSON.stringify({ display: 'browser', icons: [] }));
    const problems = checkPwa(dist);
    expect(problems).toEqual(
      expect.arrayContaining([
        'manifest sem "name"',
        'manifest sem "id"',
        'manifest sem display: standalone',
        'manifest sem ícone 192x192',
        'manifest sem ícone maskable',
        'sw.js ausente',
        '_headers ausente ou sem Content-Security-Policy',
      ]),
    );
    write('manifest.webmanifest', '{');
    expect(checkPwa(dist)).toContain('manifest.webmanifest não é JSON válido');
    rmSync(join(dist, 'manifest.webmanifest'));
    expect(checkPwa(dist)).toContain('manifest.webmanifest ausente');
  });

  it('precache no formato JSON do Workbox ("url":"…") também é somado', () => {
    validPwa();
    write('assets/a.js', 'x'.repeat(10));
    write(
      'sw.js',
      'precacheAndRoute([{"revision":"abc","url":"assets/a.js"},{"revision":null,"url":"falta.js"}])',
    );
    expect(precacheBytes(dist)).toBe(10);
  });

  it('precache acima de 3 MB reprova', () => {
    validPwa();
    write('assets/big.bin', Buffer.alloc(3 * 1024 * 1024 + 1));
    write('sw.js', 'precache([{url:"assets/big.bin"}])');
    expect(checkPwa(dist)).toEqual([expect.stringMatching(/precache .* excede 3 MB/)]);
    rmSync(join(dist, 'sw.js'));
    expect(precacheBytes(dist)).toBe(0);
  });
});
