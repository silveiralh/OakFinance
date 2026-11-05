#!/usr/bin/env bash
# Falha se o keepalive.yml não rodou com sucesso nas últimas 48 h (tech §6.5).
# Workflows agendados de repositório público param após 60 dias sem atividade.
set -euo pipefail

repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY ausente}"
since="$(date -u -d '48 hours ago' +%Y-%m-%dT%H:%M:%SZ)"
count="$(gh api "repos/$repo/actions/workflows/keepalive.yml/runs?status=success&created=>=$since&per_page=1" --jq '.total_count')"
if [ "$count" -eq 0 ]; then
  echo "::error::keepalive.yml sem execução bem-sucedida nas últimas 48 h. Reative em Actions → keepalive → Enable workflow."
  exit 1
fi
echo "keepalive: $count execução(ões) nas últimas 48 h"
