-- Conexões no snapshot do reminders-tick e novas tentativas do erro temporário (T-077; US-47, RN-81, RN-94).
begin;
select plan(7);

select tests.create_supabase_user('tick_conn');

create function pg_temp.uid() returns uuid language sql as $$ select tests.get_supabase_uid('tick_conn') $$;

insert into public.bank_connections (id, user_id, external_item_id, status, institution, connector_name,
                                     consent_expires_at, last_error, last_synced_at, is_active)
values
  ('b5000000-0000-5000-8000-000000000001', pg_temp.uid(), 'item-tick-1', 'LOGIN_ERROR', 'nubank', 'MeuPluggy',
   '2026-11-20 02:00:00+00', null, now(), true),
  -- consentimento às 01:00 UTC de 21/11 = 22:00 de 20/11 em São Paulo
  ('b5000000-0000-5000-8000-000000000002', pg_temp.uid(), 'item-tick-2', 'UPDATED', 'bb', 'MeuPluggy',
   '2026-11-21 01:00:00+00', 'UPSTREAM_UNAVAILABLE', now() - interval '2 hours', true),
  ('b5000000-0000-5000-8000-000000000003', pg_temp.uid(), 'item-tick-3', 'UPDATED', 'bb', 'MeuPluggy',
   null, 'UPSTREAM_UNAVAILABLE:4', now() - interval '2 hours', true),
  ('b5000000-0000-5000-8000-000000000004', pg_temp.uid(), 'item-tick-4', 'UPDATED', 'bb', 'MeuPluggy',
   null, 'UPSTREAM_TIMEOUT:3', now() - interval '10 minutes', true),
  ('b5000000-0000-5000-8000-000000000005', pg_temp.uid(), 'item-tick-5', 'UPDATED', 'bb', 'MeuPluggy',
   null, 'UPSTREAM_UNAVAILABLE:2', now() - interval '2 hours', false);

create temp table snap as
  select s as u from jsonb_array_elements(public.reminders_tick_snapshot('2026-11-11 13:00:00+00')) s
   where s->>'userId' = pg_temp.uid()::text;

select ok((select u ? 'connections' from snap), 'snapshot traz as conexões');
select is((select jsonb_array_length(u->'connections') from snap), 4, 'só as conexões ativas');
select is((select c->>'status' from snap, jsonb_array_elements(u->'connections') c
            where c->>'id' = 'b5000000-0000-5000-8000-000000000001'), 'LOGIN_ERROR', 'status da Pluggy');
select is((select c->>'consentExpiresOn' from snap, jsonb_array_elements(u->'connections') c
            where c->>'id' = 'b5000000-0000-5000-8000-000000000002'), '2026-11-20',
  'RN-94: fim do consentimento no fuso do usuário');

-- só a conexão 2 está com erro temporário (até a 3ª falha), há mais de 55 min e ativa; o invoke_function é trocado
-- por um registro para não chamar a rede
create temp table invoked (body jsonb);
create or replace function app.invoke_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint language plpgsql as $$ begin insert into invoked values (p_body); return 1; end $$;
select is(app.enqueue_pluggy_retry(), 1, 'RN-81: tenta de novo só o erro temporário com até 3 falhas, 1 h depois');
select is((select body->>'connectionId' from invoked), 'b5000000-0000-5000-8000-000000000002',
  'RN-81: a conexão certa, em modo incremental');
select ok(exists (select 1 from cron.job where jobname = 'pluggy-retry' and schedule = '20 * * * *'),
  'RN-81: pg_cron de hora em hora');

select * from finish();
rollback;
