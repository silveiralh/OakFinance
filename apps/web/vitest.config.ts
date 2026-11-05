import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import baseline from '../../coverage-baseline.json' with { type: 'json' };

// Limiares vêm de coverage-baseline.json (tech §8.1). Só sobem: pnpm coverage:ratchet.
const app = baseline['apps/web/src'];
const data = baseline['apps/web/src/data'];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    exclude: ['test/integration/**', 'e2e/**', 'node_modules/**'],
    setupFiles: ['./test/setup.ts'],
    allowOnly: false,
    sequence: { shuffle: true },
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/data/db-types.ts', 'src/sw/**'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        lines: app.lines,
        branches: app.branches,
        'src/data/**': { lines: data.lines, branches: data.branches },
      },
    },
  },
});
