import { defineConfig } from 'vitest/config';

// Testes dos scripts de repositório (vendor, guard, segredos, catraca). Os pacotes têm configs próprias.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
    allowOnly: false,
    sequence: { shuffle: true },
  },
});
