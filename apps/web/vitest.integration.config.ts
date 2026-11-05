import { defineConfig } from 'vitest/config';

// Testes de integração com o Supabase local (tech §8.2). Rodam em `pnpm test:db`, depois do
// `supabase db reset`, com as variáveis de `supabase status -o env`. Os casos dependem da ordem
// (o expurgo muda o horizonte do sync), por isso sem embaralhar.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.int.test.ts'],
    allowOnly: false,
    sequence: { shuffle: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
