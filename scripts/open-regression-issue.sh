#!/usr/bin/env bash
# Abre (ou comenta, se já existir aberta) a issue de regressão de um workflow (tech §8.6).
# Uso: GH_TOKEN=… scripts/open-regression-issue.sh "regressão: <job>" "<url do run>"
set -euo pipefail

title="${1:?título}"
run_url="${2:?url do run}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY ausente}"
body="O workflow falhou em main: ${run_url}

A próxima sessão começa por esta issue (CLAUDE.md §3 passo 3.1): PR \`revert:\` do commit culpado ou \`fix:\` com teste de regressão."

existing="$(gh api "repos/$repo/issues?state=open&per_page=100" --jq ".[] | select(.title == \"$title\") | .number" | head -n 1)"
if [ -n "$existing" ]; then
  gh api "repos/$repo/issues/$existing/comments" -f body="Nova falha: ${run_url}" > /dev/null
  echo "issue #$existing comentada"
else
  gh api "repos/$repo/issues" -f title="$title" -f body="$body" --jq '"issue #\(.number) aberta"'
fi
