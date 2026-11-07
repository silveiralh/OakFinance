#!/usr/bin/env bash
# Aplica migrações e publica as Edge Functions num projeto Supabase remoto (tech §8.7).
# Uso: SUPABASE_ACCESS_TOKEN=… SUPABASE_DB_PASSWORD=… scripts/deploy-supabase.sh <project-ref>
# O verify_jwt de cada função vem do supabase/config.toml. Nunca use set -x aqui.
set -euo pipefail

ref="${1:?informe o project ref}"
IMPORT_MAP="supabase/functions/deno.json"
: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN ausente}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD ausente}"

echo "migrações: aplicando"
supabase db push --remote="$ref" --password "$SUPABASE_DB_PASSWORD" --yes

functions=()
for dir in supabase/functions/*/; do
  name="$(basename "$dir")"
  if [ "$name" != "_shared" ] && [ -f "$dir/index.ts" ]; then
    functions+=("$name")
  fi
done

if [ "${#functions[@]}" -eq 0 ]; then
  echo "functions: nenhuma função para publicar"
else
  echo "functions: publicando ${functions[*]}"
  # O bundle server-side (--use-api) só lê deno.json dentro da pasta de cada função; o import map
  # único fica em supabase/functions/deno.json (tech §2), então ele vai explícito (issue #82).
  supabase functions deploy "${functions[@]}" --remote="$ref" --use-api --import-map "$IMPORT_MAP" --yes
fi
