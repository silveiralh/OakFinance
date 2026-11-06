import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import {
  buildHeaders,
  forLocalPreview,
  headersFor,
  parseHeaders,
} from '../../scripts/gen-headers.ts';
import pkg from './package.json' with { type: 'json' };
import { MANIFEST } from './src/lib/manifest.ts';

/** Cookie que o E15 usa no `vite preview` para simular uma versão nova do `sw.js` (só no próprio contexto). */
export const SW_BUMP_COOKIE = 'oak-sw-bump';

/**
 * `_headers` do Pages (CSP da tech §7.1) gerado no build, e aplicado também pelo `vite preview`: o E2E (E14) roda
 * com a mesma CSP de produção (sem `upgrade-insecure-requests`/HSTS, que exigem TLS).
 */
function headersPlugin(env: Record<string, string | undefined>): Plugin {
  let outDir = 'dist';
  return {
    name: 'oak-headers',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: buildHeaders(env) });
    },
    configurePreviewServer(server) {
      const file = join(outDir, '_headers');
      const rules = existsSync(file) ? parseHeaders(readFileSync(file, 'utf8')) : [];
      server.middlewares.use((req, res, next) => {
        const bump = new RegExp(`(?:^|;\\s*)${SW_BUMP_COOKIE}=(\\w+)`).exec(
          req.headers.cookie ?? '',
        );
        if (bump && req.url?.startsWith('/sw.js')) {
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(`${readFileSync(join(outDir, 'sw.js'), 'utf8')}\n// e2e ${bump[1]}\n`);
          return;
        }
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        // A navegação do SPA é servida pelo index.html (fallback do `_redirects`)
        const target = pathname.includes('.') ? pathname : '/index.html';
        const merged = { ...headersFor(rules, pathname), ...headersFor(rules, target) };
        for (const [name, value] of Object.entries(forLocalPreview(merged))) {
          res.setHeader(name, value);
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  return {
    plugins: [
      react(),
      tailwindcss(),
      headersPlugin(env),
      // PWA (tech §4.8): SW próprio em src/sw/sw.ts; o registro e o aviso de nova versão ficam no app (G07)
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src/sw',
        filename: 'sw.ts',
        registerType: 'prompt',
        injectRegister: false,
        manifest: MANIFEST,
        includeManifestIcons: false,
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest,wasm}'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
        devOptions: { enabled: false },
      }),
    ],
    define: {
      __APP_VERSION__: JSON.stringify(sha ? `${pkg.version}+${sha}` : pkg.version),
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { target: 'es2022', sourcemap: false },
  };
});
