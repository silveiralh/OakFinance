-- Migração 11 — registro do `pluggy-sync` em app.job_runs (tech §6.1.4 passos 1 e 6; T-074). Aditiva.
-- Só a Edge Function, com a chave secreta (service_role), abre e fecha a execução.
create or replace function public.pluggy_sync_start(p_user uuid, p_connection uuid) returns bigint
language sql security definer set search_path = '' as $$
  insert into app.job_runs (job, user_id, ref, status)
  values ('pluggy-sync', p_user, p_connection::text, 'running')
  returning id;
$$;

create or replace function public.pluggy_sync_finish(p_run bigint, p_status text, p_stats jsonb, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update app.job_runs
     set finished_at = now(), status = p_status, stats = coalesce(p_stats, '{}'::jsonb), error = left(p_error, 200)
   where id = p_run and job = 'pluggy-sync';
$$;

revoke all on function public.pluggy_sync_start(uuid, uuid), public.pluggy_sync_finish(bigint, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.pluggy_sync_start(uuid, uuid), public.pluggy_sync_finish(bigint, text, jsonb, text)
  to service_role;
