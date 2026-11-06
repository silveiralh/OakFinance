-- T-035: `app.writable_columns` passa a ignorar colunas geradas (ex.: `categories.name_ci`). O `sync_push` monta o
-- insert com essas colunas, e o Postgres recusa valor explícito em coluna `generated always`, então toda categoria
-- enviada pelo aparelho (inclusive os seeds da tech §3.8) voltava `rejected`. Só redefine a função (sem DDL
-- destrutivo); assinatura e privilégios iguais.
create or replace function app.writable_columns(p_table text) returns text[]
language sql stable set search_path = '' as $$
  select array_agg(a.attname::text order by a.attnum)
  from pg_catalog.pg_attribute a
  where a.attrelid = ('public.' || quote_ident(p_table))::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attgenerated = ''
    and a.attname not in ('user_id','created_at','updated_at','server_version')
$$;
