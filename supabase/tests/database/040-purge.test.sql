-- Expurgo (tech §3.7 e §8.3 item 10): retenção dos tombstones, horizonte do sync e
-- pai com filho vivo sem derrubar o job. RN-98 (histórico de 12 meses), RN-99 (reset por horizonte).
begin;
select plan(11);

select tests.create_supabase_user('purge_a');

-- Tombstone antigo, tombstone recente e linha viva
insert into public.accounts (id, user_id, name, type, deleted_at) values
  ('e1000000-0000-4000-8000-000000000001', tests.get_supabase_uid('purge_a'), 'Antiga', 'checking', now() - interval '120 days'),
  ('e1000000-0000-4000-8000-000000000002', tests.get_supabase_uid('purge_a'), 'Recente', 'checking', now() - interval '10 days'),
  ('e1000000-0000-4000-8000-000000000003', tests.get_supabase_uid('purge_a'), 'Viva', 'checking', null);
-- Pai expurgável com filho vivo: a conta antiga 4 tem um lançamento não excluído
insert into public.accounts (id, user_id, name, type, deleted_at) values
  ('e1000000-0000-4000-8000-000000000004', tests.get_supabase_uid('purge_a'), 'Pai', 'checking', now() - interval '120 days');
insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id)
values ('e1000000-0000-4000-8000-000000000005', tests.get_supabase_uid('purge_a'), 'expense', 100, '2026-11-05', 'pix',
        'e1000000-0000-4000-8000-000000000004');
-- Histórico antigo e recente
insert into app.row_history (user_id, table_name, row_id, op, changed_at) values
  (tests.get_supabase_uid('purge_a'), 'accounts', 'e1000000-0000-4000-8000-000000000003', 'update', now() - interval '400 days'),
  (tests.get_supabase_uid('purge_a'), 'accounts', 'e1000000-0000-4000-8000-000000000003', 'update', now() - interval '300 days');
update app.sync_config set purge_horizon_version = 0;

create temporary table antes as
  select server_version from public.accounts where id = 'e1000000-0000-4000-8000-000000000001';

select lives_ok($$ select app.purge() $$, 'purge roda mesmo com pai bloqueado por filho vivo');

select is((select count(*)::int from public.accounts where id = 'e1000000-0000-4000-8000-000000000001'), 0,
  'tombstone com mais de 90 dias é expurgado');
select is((select count(*)::int from public.accounts where id = 'e1000000-0000-4000-8000-000000000002'), 1,
  'tombstone recente fica (retenção de 90 dias)');
select is((select count(*)::int from public.accounts where id = 'e1000000-0000-4000-8000-000000000003'), 1,
  'linha viva nunca é expurgada');
select is((select count(*)::int from public.accounts where id = 'e1000000-0000-4000-8000-000000000004'), 1,
  'pai com filho vivo fica (foreign_key_violation capturada)');
select ok((select purge_horizon_version from app.sync_config) >= (select server_version from antes),
  'RN-99: o horizonte avança até a maior versão expurgada');
select is((select status from app.job_runs where job = 'purge' order by id desc limit 1), 'partial',
  'job_runs registra o expurgo parcial');
select ok((select error from app.job_runs where job = 'purge' order by id desc limit 1) like '%accounts%',
  'job_runs nomeia a tabela bloqueada');
select is((select count(*)::int from app.row_history
            where row_id = 'e1000000-0000-4000-8000-000000000003' and changed_at < now() - interval '365 days'), 0,
  'RN-98: histórico com mais de 12 meses é expurgado');
select is((select count(*)::int from app.row_history
            where row_id = 'e1000000-0000-4000-8000-000000000003' and changed_at > now() - interval '365 days'), 1,
  'RN-98: histórico dentro de 12 meses fica');

-- ops_health só para service_role
select tests.authenticate_as('purge_a');
select throws_ok($$ select public.ops_health() $$, '42501', null, 'ops_health não é executável por authenticated');

select * from finish();
rollback;
