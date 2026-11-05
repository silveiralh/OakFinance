#!/usr/bin/env bash
# Testes *.int.test.ts contra o Supabase local já iniciado (tech §8.2).
# Lê URL e chaves locais de `supabase status -o env` sem imprimi-las.
set -euo pipefail
set -a
eval "$(supabase status -o env 2>/dev/null)"
set +a
pnpm --filter @oakfinance/web exec vitest run --config vitest.integration.config.ts
