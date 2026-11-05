-- Migração 04 — sync, histórico e observabilidade (tech §3.5 e §4.7, [CONTRATO]).
-- DDL e RPCs sync_push/sync_pull literais da spec; demais RPCs e helpers conforme as assinaturas da §4.7.
-- Não editar depois do merge.
-- 20261105000004_sync.sql
create table app.sync_applied_mutations (
  user_id     uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  table_name  text not null,
  row_id      uuid not null,
  status      text not null,                     -- applied | stale | rejected
  applied_at  timestamptz not null default now(),
  primary key (user_id, mutation_id)
);

create table app.row_history (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  table_name     text not null,
  row_id         uuid not null,
  op             text not null check (op in ('update','delete','restore','stale_write')),
  old_row        jsonb,                          -- versão substituída (ou a atual, em stale_write)
  rejected_row   jsonb,                          -- a escrita perdedora, em stale_write
  old_version    bigint,
  device_id      text,
  changed_at     timestamptz not null default now()
);
create index row_history_row_idx on app.row_history (user_id, table_name, row_id, changed_at desc);

create table app.devices (
  user_id        uuid not null references auth.users(id) on delete cascade,
  device_id      text not null,
  platform       text,
  app_version    text,
  last_push_at   timestamptz,
  last_pull_at   timestamptz,
  last_cursor    bigint,
  primary key (user_id, device_id)
);

create table app.app_events (                    -- log mínimo do cliente e das funções (30 dias)
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  at         timestamptz not null default now(),
  level      text not null check (level in ('debug','info','warn','error')),
  code       text not null,                      -- AppError.code ou evento ('sync.done')
  message    text,                               -- SEM valores monetários, descrições ou PII
  context    jsonb not null default '{}'::jsonb,
  app_version text,
  device_id  text
);
create index app_events_at_idx on app.app_events (at);

create table app.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null,                     -- 'pluggy-sync' | 'reminders-tick' | 'purge' | …
  user_id     uuid,
  ref         text,                              -- connection_id etc.
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running','ok','partial','error')),
  stats       jsonb not null default '{}'::jsonb,
  error       text
);
create index job_runs_job_idx on app.job_runs (job, started_at desc);

create table app.rate_limits (
  user_id  uuid not null,
  bucket   text not null,                        -- 'nfce-fetch' | 'pluggy-sync-manual' | …
  window_start timestamptz not null,
  count    int not null default 0,
  primary key (user_id, bucket, window_start)
);

create table app.allowed_emails (email text primary key check (email = lower(email)));

insert into app.sync_tables (table_name, client_writable, push_order) values
  ('profiles',true,10),('accounts',true,20),('cards',true,30),('categories',true,40),
  ('category_rules',true,50),('invoices',true,60),('installment_plans',true,70),
  ('recurrences',true,80),('goals',true,90),('budgets',true,100),('imports',true,110),
  ('nfce_receipts',true,120),('transactions',true,130),('receipt_items',true,140),
  ('reminders',true,150),('notices',true,155),('month_closings',true,158),
  ('bank_connections',false,160),('external_accounts',false,170);

-- Colunas que o cliente pode escrever (todas menos as geridas pelo servidor)
create or replace function app.writable_columns(p_table text) returns text[]
language sql stable set search_path = '' as $$
  select array_agg(a.attname::text order by a.attnum)
  from pg_catalog.pg_attribute a
  where a.attrelid = ('public.' || quote_ident(p_table))::regclass
    and a.attnum > 0 and not a.attisdropped
    and a.attname not in ('user_id','created_at','updated_at','server_version')
$$;

-- Trigger único de todas as tabelas sincronizadas
create or replace function app.tg_sync_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Serializa as escritas de um mesmo usuário: server_version fica monotônico na ordem de commit,
  -- o que torna o pull por cursor seguro (ver 4.6).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 7341));

  -- Limita relógio adiantado do aparelho
  if new.client_updated_at > now() + interval '5 minutes' then
    new.client_updated_at := now();
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then
      raise exception 'user_id é imutável' using errcode = '42501';
    end if;
    -- LWW: escrita mais antiga que a atual é descartada e registrada
    if new.client_updated_at < old.client_updated_at then
      insert into app.row_history (user_id, table_name, row_id, op, old_row, rejected_row, old_version, device_id)
      values (old.user_id, tg_table_name, old.id, 'stale_write', to_jsonb(old), to_jsonb(new), old.server_version, new.device_id);
      return null;                                 -- ignora a escrita (row_count = 0)
    end if;
    insert into app.row_history (user_id, table_name, row_id, op, old_row, old_version, device_id)
    values (old.user_id, tg_table_name, old.id,
      case when new.deleted_at is not null and old.deleted_at is null then 'delete'
           when new.deleted_at is null and old.deleted_at is not null then 'restore'
           else 'update' end,
      to_jsonb(old), old.server_version, new.device_id);
    new.created_at := old.created_at;
  end if;

  new.updated_at := now();
  new.server_version := nextval('app.sync_version_seq');
  return new;
end $$;

do $$ declare t text; begin
  for t in select table_name from app.sync_tables loop
    execute format('create trigger sync_row before insert or update on public.%I
                    for each row execute function app.tg_sync_row()', t);
  end loop; end $$;

-- Visão unificada para o pull (security_invoker: RLS das tabelas vale)
create or replace view app.v_sync_rows with (security_invoker = true) as
            select 'profiles'::text t, user_id, server_version, to_jsonb(x) r from public.profiles x
  union all select 'accounts',          user_id, server_version, to_jsonb(x) from public.accounts x
  union all select 'cards',             user_id, server_version, to_jsonb(x) from public.cards x
  union all select 'categories',        user_id, server_version, to_jsonb(x) from public.categories x
  union all select 'category_rules',    user_id, server_version, to_jsonb(x) from public.category_rules x
  union all select 'invoices',          user_id, server_version, to_jsonb(x) from public.invoices x
  union all select 'installment_plans', user_id, server_version, to_jsonb(x) from public.installment_plans x
  union all select 'recurrences',       user_id, server_version, to_jsonb(x) from public.recurrences x
  union all select 'goals',             user_id, server_version, to_jsonb(x) from public.goals x
  union all select 'budgets',           user_id, server_version, to_jsonb(x) from public.budgets x
  union all select 'imports',           user_id, server_version, to_jsonb(x) from public.imports x
  union all select 'nfce_receipts',     user_id, server_version, to_jsonb(x) from public.nfce_receipts x
  union all select 'transactions',      user_id, server_version, to_jsonb(x) from public.transactions x
  union all select 'receipt_items',     user_id, server_version, to_jsonb(x) from public.receipt_items x
  union all select 'reminders',         user_id, server_version, to_jsonb(x) from public.reminders x
  union all select 'notices',           user_id, server_version, to_jsonb(x) from public.notices x
  union all select 'month_closings',    user_id, server_version, to_jsonb(x) from public.month_closings x
  union all select 'bank_connections',  user_id, server_version, to_jsonb(x) from public.bank_connections x
  union all select 'external_accounts', user_id, server_version, to_jsonb(x) from public.external_accounts x;
grant select on app.v_sync_rows to authenticated;

-- ---------------------------------------------------------------------------
-- Funções auxiliares do sync (tech §4.7, nota de privilégios). security definer,
-- search_path vazio, sempre filtrando por auth.uid(); execute só para authenticated.
-- ---------------------------------------------------------------------------

create or replace function app.mutation_seen(p_mutation_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.sync_applied_mutations
     where user_id = (select auth.uid()) and mutation_id = p_mutation_id)
$$;

create or replace function app.record_mutation(p_mutation_id uuid, p_table text, p_row_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_mutation_id is null or p_row_id is null or (select auth.uid()) is null then
    return;
  end if;
  insert into app.sync_applied_mutations (user_id, mutation_id, table_name, row_id, status)
  values ((select auth.uid()), p_mutation_id, p_table, p_row_id, p_status)
  on conflict do nothing;
end $$;

create or replace function app.touch_device(p_device_id text, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_device_id is null or p_device_id = '' then
    return;
  end if;
  insert into app.devices (user_id, device_id, last_push_at, last_pull_at)
  values (v_uid, p_device_id,
          case when p_kind = 'push' then now() end,
          case when p_kind = 'pull' then now() end)
  on conflict (user_id, device_id) do update
     set last_push_at = case when p_kind = 'push' then now() else app.devices.last_push_at end,
         last_pull_at = case when p_kind = 'pull' then now() else app.devices.last_pull_at end;
end $$;

create or replace function app.get_horizon() returns bigint
language sql stable security definer set search_path = '' as $$
  select purge_horizon_version from app.sync_config where id
$$;

revoke all on function app.mutation_seen(uuid), app.record_mutation(uuid, text, uuid, text),
  app.touch_device(text, text), app.get_horizon(), app.writable_columns(text) from public;
grant execute on function app.mutation_seen(uuid), app.record_mutation(uuid, text, uuid, text),
  app.touch_device(text, text), app.get_horizon(), app.writable_columns(text) to authenticated;
-- sync_push (security invoker) lê o registro de tabelas sincronizadas: só leitura, sem dado de usuário (D-008)
grant select on app.sync_tables to authenticated;

-- ---------------------------------------------------------------------------
-- sync_push e sync_pull (tech §4.7, literais)
-- ---------------------------------------------------------------------------
create or replace function public.sync_push(p_device_id text, p_mutations jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  m jsonb; v_table text; v_cols text[]; v_sql text; v_count int; v_row jsonb; v_ver bigint;
  v_results jsonb := '[]'::jsonb; v_status text; v_current jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_mutations) <> 'array' or jsonb_array_length(p_mutations) > 200 then
    raise exception 'lote inválido' using errcode = '22023';
  end if;

  for m in
    select e.value from jsonb_array_elements(p_mutations) with ordinality e(value, ord)
    left join app.sync_tables st on st.table_name = e.value->>'table'
    order by coalesce(st.push_order, 9999), e.ord            -- pais antes de filhos, estável
  loop
    if app.mutation_seen((m->>'mutation_id')::uuid) then
      v_results := v_results || jsonb_build_object('mutation_id', m->'mutation_id', 'status', 'duplicate');
      continue;
    end if;

    select table_name into v_table from app.sync_tables
     where table_name = m->>'table' and client_writable;
    if v_table is null then
      v_results := v_results || jsonb_build_object('mutation_id', m->'mutation_id', 'status', 'rejected', 'code', 'TABLE_NOT_WRITABLE');
      continue;
    end if;

    v_cols := app.writable_columns(v_table);
    v_row  := (m->'row') || jsonb_build_object('device_id', p_device_id);
    v_sql := format(
      'insert into public.%1$I as t (%2$s, user_id)
         select %3$s, $2 from jsonb_populate_record(null::public.%1$I, $1) r
       on conflict (id) do update set (%4$s) = row(%5$s) where t.user_id = $2
       returning t.server_version',
      v_table,
      (select string_agg(quote_ident(c), ',') from unnest(v_cols) c),
      (select string_agg('r.' || quote_ident(c), ',') from unnest(v_cols) c),
      (select string_agg(quote_ident(c), ',') from unnest(v_cols) c where c <> 'id'),
      (select string_agg('excluded.' || quote_ident(c), ',') from unnest(v_cols) c where c <> 'id'));

    begin                                                    -- subtransação por mutação
      v_ver := null;
      execute v_sql into v_ver using v_row, v_uid;
      get diagnostics v_count = row_count;
      if v_count = 1 then
        v_status := 'applied';
        v_results := v_results || jsonb_build_object('mutation_id', m->'mutation_id', 'status', v_status, 'server_version', v_ver);
      else
        execute format('select to_jsonb(t) from public.%I t where id = $1 and user_id = $2', v_table)
          into v_current using (m->'row'->>'id')::uuid, v_uid;
        v_status := case when v_current is null then 'rejected' else 'stale' end;
        v_results := v_results || jsonb_build_object('mutation_id', m->'mutation_id', 'status', v_status,
                       'code', case when v_current is null then 'FOREIGN_ROW' end, 'row', v_current);
      end if;
    exception when others then
      v_status := 'rejected';
      v_results := v_results || jsonb_build_object('mutation_id', m->'mutation_id', 'status', v_status,
                     'code', sqlstate, 'message', left(sqlerrm, 200));
    end;

    perform app.record_mutation((m->>'mutation_id')::uuid, m->>'table', (m->'row'->>'id')::uuid, v_status);
  end loop;

  perform app.touch_device(p_device_id, 'push');

  return jsonb_build_object('results', v_results, 'server_time', now());
end $$;

create or replace function public.sync_pull(p_since bigint, p_limit int default 500)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_rows jsonb; v_next bigint; v_horizon bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  v_horizon := app.get_horizon();
  if p_since > 0 and p_since < v_horizon then
    return jsonb_build_object('reset_required', true, 'server_time', now());
  end if;
  with page as (
    select t, server_version, r from app.v_sync_rows
     where user_id = v_uid and server_version > p_since
     order by server_version
     limit least(greatest(p_limit, 1), 1000))
  select coalesce(jsonb_agg(jsonb_build_object('t', t, 'v', server_version, 'r', r) order by server_version), '[]'::jsonb),
         max(server_version)
    into v_rows, v_next from page;
  return jsonb_build_object(
    'rows', v_rows,
    'next', coalesce(v_next, p_since),
    'has_more', exists (select 1 from app.v_sync_rows where user_id = v_uid and server_version > coalesce(v_next, p_since)),
    'server_time', now());
end $$;

-- ---------------------------------------------------------------------------
-- Outras RPCs (tech §4.7, tabela "Outras RPCs")
-- ---------------------------------------------------------------------------

-- Histórico de uma linha (tela "Histórico do lançamento"), só do próprio usuário
create or replace function public.get_row_history(p_table text, p_row_id uuid) returns jsonb[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(jsonb_build_object(
           'op', h.op, 'old_row', h.old_row, 'rejected_row', h.rejected_row,
           'old_version', h.old_version, 'device_id', h.device_id, 'changed_at', h.changed_at)
         order by h.changed_at desc, h.id desc), '{}'::jsonb[])
    from app.row_history h
   where h.user_id = (select auth.uid()) and h.table_name = p_table and h.row_id = p_row_id
$$;

-- Mapeia uma conta do provedor para uma conta ou cartão local (ou ignora). Só o dono.
create or replace function public.map_external_account(
  p_id uuid, p_account_id uuid, p_card_id uuid, p_is_ignored boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_account_id is not null and p_card_id is not null then
    raise exception 'informe conta ou cartão, não os dois' using errcode = '22023';
  end if;
  if not exists (select 1 from public.external_accounts
                  where id = p_id and user_id = v_uid and deleted_at is null) then
    raise exception 'conta externa não encontrada' using errcode = 'P0002';
  end if;
  if p_account_id is not null and not exists (
       select 1 from public.accounts where id = p_account_id and user_id = v_uid and deleted_at is null) then
    raise exception 'conta não encontrada' using errcode = 'P0002';
  end if;
  if p_card_id is not null and not exists (
       select 1 from public.cards where id = p_card_id and user_id = v_uid and deleted_at is null) then
    raise exception 'cartão não encontrado' using errcode = 'P0002';
  end if;
  update public.external_accounts
     set account_id = p_account_id,
         card_id = p_card_id,
         is_ignored = coalesce(p_is_ignored, false),
         client_updated_at = now()
   where id = p_id and user_id = v_uid;
end $$;

-- Registra ou renova a inscrição de push. Endpoint repetido de outro usuário é reatribuído (D-008).
create or replace function public.upsert_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_platform text, p_user_agent text, p_device_id text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform, user_agent, device_id)
  values (v_uid, p_endpoint, p_p256dh, p_auth, p_platform, p_user_agent, p_device_id)
  on conflict (endpoint) do update
     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         platform = excluded.platform, user_agent = excluded.user_agent, device_id = excluded.device_id,
         failure_count = 0, last_failure_at = null, disabled_at = null
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security invoker set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid())
$$;

-- Telemetria mínima do cliente (sem valores, descrições nem PII): até 50 eventos de até 4 KB
create or replace function public.log_events(p_events jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); e jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then
    raise exception 'lote inválido' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_events) loop
    if octet_length(e::text) > 4096 then
      raise exception 'evento maior que 4 KB' using errcode = '22023';
    end if;
    insert into app.app_events (user_id, at, level, code, message, context, app_version, device_id)
    values (v_uid,
            coalesce((e->>'at')::timestamptz, now()),
            coalesce(e->>'level', 'info'),
            e->>'code',
            left(e->>'message', 500),
            coalesce(e->'context', '{}'::jsonb),
            e->>'app_version',
            e->>'device_id');
  end loop;
end $$;

-- Keepalive (tech §6.5): pode ser chamada com a chave publicável
create or replace function public.ping() returns timestamptz
language sql stable security invoker set search_path = '' as $$
  select now()
$$;

revoke all on function public.sync_push(text, jsonb), public.sync_pull(bigint, int),
  public.get_row_history(text, uuid), public.map_external_account(uuid, uuid, uuid, boolean),
  public.upsert_push_subscription(text, text, text, text, text, text),
  public.delete_push_subscription(text), public.log_events(jsonb) from public, anon;
grant execute on function public.sync_push(text, jsonb), public.sync_pull(bigint, int),
  public.get_row_history(text, uuid), public.map_external_account(uuid, uuid, uuid, boolean),
  public.upsert_push_subscription(text, text, text, text, text, text),
  public.delete_push_subscription(text), public.log_events(jsonb) to authenticated;
grant execute on function public.ping() to anon, authenticated;
