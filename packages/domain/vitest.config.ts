import { defineConfig } from 'vitest/config';
import baseline from '../../coverage-baseline.json' with { type: 'json' };

// Limiares vêm de coverage-baseline.json (tech §8.1). Só sobem: pnpm coverage:ratchet.
const thresholds = baseline['packages/domain'];

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    allowOnly: false,
    sequence: { shuffle: true },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: {
        lines: thresholds.lines,
        branches: thresholds.branches,
      },
    },
  },
});
