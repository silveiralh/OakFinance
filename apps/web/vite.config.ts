import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import {
  buildHeaders,
  forLocalPreview,
  headersFor,
  parseHeaders,
} from '../../scripts/gen-headers.ts';
import pkg from './package.json' with { type: 'json' };

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

// O PWA (vite-plugin-pwa, injectManifest) entra na T-030.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const sha = (process.env.GITHUB_SHA ?? '').slice(0, 7);
  return {
    plugins: [react(), tailwindcss(), headersPlugin(env)],
    define: {
      __APP_VERSION__: JSON.stringify(sha ? `${pkg.version}+${sha}` : pkg.version),
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: { target: 'es2022', sourcemap: false },
  };
});
