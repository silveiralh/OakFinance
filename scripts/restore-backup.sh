#!/usr/bin/env bash
# Ensaio de restauração do backup cifrado (T-098, tech §8.7 item 1, US-05).
#
# Uso:
#   BACKUP_PASSPHRASE=… scripts/restore-backup.sh <arquivo .tar.gz.enc>                  # só os dados
#   BACKUP_PASSPHRASE=… scripts/restore-backup.sh <arquivo .tar.gz.enc> --with-schema    # banco vazio
#   BACKUP_PASSPHRASE=… scripts/restore-backup.sh <arquivo .tar.gz.enc> --decrypt-only <pasta>
#
# Padrão: aplica só `data.sql` sobre o schema das migrações (rode `supabase db reset` antes, que deixa o banco
# local com o mesmo schema de produção). `--with-schema` aplica `schema.sql` antes, para um banco vazio.
# Sem DATABASE_URL, usa o Supabase local (`supabase start`, porta 54322). Só aceita banco local
# (127.0.0.1, localhost ou ::1): este script nunca escreve em staging nem em produção.
# `--decrypt-only` só decifra e extrai `schema.sql` e `data.sql` na pasta indicada (umask 077).
# O cliente roda o roteiro completo do HANDOFF §6; nada do dump entra no repositório.
set -euo pipefail

usage() {
  echo "uso: BACKUP_PASSPHRASE=… $0 <backup.tar.gz.enc> [--with-schema | --decrypt-only <pasta>]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
archive="$1"
shift
target_dir=""
with_schema=0
case "${1:-}" in
  "") ;;
  --with-schema)
    [ $# -eq 1 ] || usage
    with_schema=1
    ;;
  --decrypt-only)
    [ $# -eq 2 ] || usage
    target_dir="$2"
    ;;
  *) usage ;;
esac

if [ ! -f "$archive" ]; then
  echo "restore: arquivo não encontrado: $archive" >&2
  exit 2
fi
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "restore: BACKUP_PASSPHRASE ausente (a mesma frase do secret do GitHub, SETUP-12)" >&2
  exit 2
fi

umask 077
work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

# mesmo formato do backup.yml: tar.gz de schema.sql e data.sql, cifrado com aes-256-cbc + pbkdf2
if ! openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$archive" | tar -C "$work" -xzf - schema.sql data.sql; then
  echo "restore: não foi possível decifrar (frase errada ou arquivo corrompido)" >&2
  exit 1
fi

if [ -n "$target_dir" ]; then
  mkdir -p "$target_dir"
  cp "$work/schema.sql" "$work/data.sql" "$target_dir/"
  echo "restore: schema.sql e data.sql extraídos em $target_dir"
  exit 0
fi

url="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
host="$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^@/]*@)?(\[[^]]*\]|[^:/?]*).*#\2#')"
case "$host" in
  127.0.0.1 | localhost | "[::1]") ;;
  *)
    echo "restore: recusado: só restaura em banco local (host atual: $host)" >&2
    exit 2
    ;;
esac

if [ "$with_schema" -eq 1 ]; then
  psql "$url" -v ON_ERROR_STOP=1 -q -f "$work/schema.sql"
fi
psql "$url" -v ON_ERROR_STOP=1 -q -c "set session_replication_role = replica" -f "$work/data.sql"
echo "restore: concluído em $host"
