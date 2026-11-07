-- pluggy_sync_start/finish (T-074, tech §6.1.4): só service_role; a execução fica em app.job_runs com o usuário e
-- a conexão, e fecha com status e estatísticas.
begin;
select plan(6);

select tests.create_supabase_user('ps_a');

select ok(not has_function_privilege('authenticated', 'public.pluggy_sync_start(uuid, uuid)', 'execute'),
  'authenticated não abre execução');
select ok(not has_function_privilege('anon', 'public.pluggy_sync_finish(bigint, text, jsonb, text)', 'execute'),
  'anon não fecha execução');
select ok(has_function_privilege('service_role', 'public.pluggy_sync_start(uuid, uuid)', 'execute'),
  'service_role abre execução');

create temp table run as
  select public.pluggy_sync_start(tests.get_supabase_uid('ps_a'), 'b1000000-0000-4000-8000-000000000001') as id;

select is((select status from app.job_runs where id = (select id from run)), 'running', 'abre como running');
select public.pluggy_sync_finish((select id from run), 'ok', '{"inserted":3}'::jsonb);
select is((select stats->>'inserted' from app.job_runs where id = (select id from run)), '3',
  'fecha com as estatísticas');
select is((select ref from app.job_runs where id = (select id from run) and job = 'pluggy-sync'
            and user_id = tests.get_supabase_uid('ps_a')),
  'b1000000-0000-4000-8000-000000000001', 'registra usuário e conexão');

select * from finish();
rollback;
