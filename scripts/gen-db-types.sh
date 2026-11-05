#!/usr/bin/env bash
# Gera apps/web/src/data/db-types.ts a partir do Supabase local (tech §8.2, drift de tipos).
# Uso: scripts/gen-db-types.sh          → regrava o arquivo
#      scripts/gen-db-types.sh --check  → falha se o arquivo versionado estiver desatualizado
# A saída passa pelo formatador do Biome para o arquivo versionado seguir o padrão do repositório.
set -euo pipefail

target="apps/web/src/data/db-types.ts"
tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.fmt"' EXIT

supabase gen types typescript --local > "$tmp"
pnpm exec biome format --stdin-file-path="$target" < "$tmp" > "$tmp.fmt"

if [ "${1:-}" = "--check" ]; then
  if ! diff -q "$target" "$tmp.fmt" > /dev/null 2>&1; then
    echo "db-types.ts desatualizado: rode pnpm db:types e faça commit. Arquivo gerado:"
    echo "----- INICIO db-types.ts -----"
    cat "$tmp.fmt"
    echo "----- FIM db-types.ts -----"
    exit 1
  fi
  echo "db-types: sem drift"
else
  mkdir -p "$(dirname "$target")"
  cp "$tmp.fmt" "$target"
  echo "db-types: $target atualizado"
fi
