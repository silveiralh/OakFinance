-- Migração 07 — cron (tech §3.7, [CONTRATO]). DDL da spec; app.purge() captura foreign_key_violation por tabela
-- e registra em app.job_runs (nota da §3.7); ops_health() da §7.3. Não editar depois do merge.
-- 20261105000007_cron.sql   (horários em UTC; America/Sao_Paulo = UTC-3, sem horário de verão)
-- Segredos lidos do Vault: 'project_url' e 'cron_secret_key' (criados pelo cliente, seção 9).
create or replace function app.invoke_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type','application/json',
               'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret_key')),
    body    := p_body,
    timeout_milliseconds := 10000);
$$;

-- Uma chamada de pluggy-sync por conexão ativa (cada uma cabe no limite de 150 s / 2 s de CPU)
create or replace function app.enqueue_pluggy_sync() returns int
language plpgsql security definer set search_path = '' as $$
declare c record; n int := 0;
begin
  for c in select id from public.bank_connections where is_active and deleted_at is null loop
    perform app.invoke_function('pluggy-sync', jsonb_build_object('connectionId', c.id, 'mode', 'incremental'));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app.purge() returns void
language plpgsql security definer set search_path = '' as $$
declare v_cut timestamptz := now() - (select tombstone_retention from app.sync_config); v_max bigint := 0; v bigint; t text;
        v_started timestamptz := clock_timestamp(); v_blocked text[] := '{}'; v_id uuid; v_ver bigint;
begin
  -- filhos antes dos pais (ordem inversa de push_order)
  for t in select table_name from app.sync_tables where table_name <> 'profiles' order by push_order desc loop
    begin
      execute format('with d as (delete from public.%I where deleted_at < $1 returning server_version)
                      select coalesce(max(server_version),0) from d', t) into v using v_cut;
      v_max := greatest(v_max, v);
    exception when foreign_key_violation then
      -- pai expurgável com filho vivo: expurga linha a linha, pula as bloqueadas, registra e segue
      -- (tech §3.7, nota da expurgação)
      v_blocked := v_blocked || t;
      for v_id, v_ver in execute format('select id, server_version from public.%I where deleted_at < $1', t) using v_cut loop
        begin
          execute format('delete from public.%I where id = $1', t) using v_id;
          v_max := greatest(v_max, v_ver);
        exception when foreign_key_violation then
          null;
        end;
      end loop;
    end;
  end loop;
  update app.sync_config set purge_horizon_version = greatest(purge_horizon_version, v_max);
  delete from app.sync_applied_mutations where applied_at < now() - interval '30 days';
  delete from app.row_history  where changed_at < now() - interval '365 days';                 -- RN-98: 12 meses
  delete from app.app_events   where at < now() - interval '30 days' and code not like 'usage.%';
  delete from app.app_events   where at < now() - interval '180 days' and code like 'usage.%';   -- RN-104: métricas
  delete from app.job_runs     where started_at < now() - interval '90 days';
  delete from app.rate_limits  where window_start < now() - interval '2 days';
  delete from app.integration_events where received_at < now() - interval '30 days';
  delete from public.notification_outbox where created_at < now() - interval '60 days';
  update public.notices set deleted_at = now(), client_updated_at = now(), device_id = 'server:purge'
   where read_at < now() - interval '60 days' and deleted_at is null;                         -- US-37
  insert into app.job_runs (job, started_at, finished_at, status, stats, error)
  values ('purge', v_started, clock_timestamp(),
          case when cardinality(v_blocked) > 0 then 'partial' else 'ok' end,
          jsonb_build_object('horizon', (select purge_horizon_version from app.sync_config), 'fk_blocked', to_jsonb(v_blocked)),
          case when cardinality(v_blocked) > 0 then 'foreign_key_violation em ' || array_to_string(v_blocked, ', ') end);
end $$;

-- Saúde operacional para o keepalive.yml (tech §7.3): só service_role
create or replace function public.ops_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'job_errors_24h', (select count(*)::int from app.job_runs
                        where status = 'error' and started_at > now() - interval '24 hours'),
    'reminders_tick_age_minutes', (select floor(extract(epoch from now() - max(started_at)) / 60)::int
                                     from app.job_runs
                                    where job = 'reminders-tick' and status in ('ok', 'partial')))
$$;
revoke all on function public.ops_health() from public, anon, authenticated;
grant execute on function public.ops_health() to service_role;

revoke all on function app.invoke_function(text, jsonb), app.enqueue_pluggy_sync(), app.purge() from public, anon, authenticated;

select cron.schedule('reminders-tick', '*/15 * * * *', $$ select app.invoke_function('reminders-tick') $$);
select cron.schedule('pluggy-sync-am', '40 10 * * *',  $$ select app.enqueue_pluggy_sync() $$);  -- 07:40 BRT
select cron.schedule('pluggy-sync-pm', '40 22 * * *',  $$ select app.enqueue_pluggy_sync() $$);  -- 19:40 BRT
select cron.schedule('purge',          '17 6 * * *',   $$ select app.purge() $$);                 -- 03:17 BRT
select cron.schedule('cron-history-cleanup', '23 6 * * 0',
  $$ delete from cron.job_run_details where end_time < now() - interval '14 days' $$);
