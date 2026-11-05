-- RLS e cadastro fechado (tech §8.3 itens 1–5, 7 e 8). US-01 (login só da allowlist),
-- US-02 (dados de cada pessoa são só dela), RN-101 e RN-102.
begin;
select plan(26);

select tests.create_supabase_user('rls_a');
select tests.create_supabase_user('rls_b');

-- Dados de A (como postgres)
insert into public.accounts (id, user_id, name, type)
values ('a1000000-0000-4000-8000-000000000001', tests.get_supabase_uid('rls_a'), 'Conta de A', 'checking');
insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id)
values ('a1000000-0000-4000-8000-000000000002', tests.get_supabase_uid('rls_a'), 'expense', 1500, '2026-11-05', 'pix',
        'a1000000-0000-4000-8000-000000000001');
insert into public.bank_connections (id, user_id, external_item_id, status)
values ('a1000000-0000-4000-8000-000000000003', tests.get_supabase_uid('rls_a'), 'item-teste-a', 'UPDATED');
insert into public.external_accounts (id, user_id, connection_id, external_account_id, type, subtype)
values ('a1000000-0000-4000-8000-000000000004', tests.get_supabase_uid('rls_a'), 'a1000000-0000-4000-8000-000000000003',
        'conta-teste-a', 'BANK', 'CHECKING_ACCOUNT');
insert into public.notification_outbox (user_id, kind, dedupe_key, payload)
values (tests.get_supabase_uid('rls_a'), 'daily_log', 'daily_log:teste', '{}');

-- 1. Todas as tabelas de public com RLS habilitada e forçada
create function pg_temp.tabelas_sem_rls() returns int language sql as $$
  select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and not (c.relrowsecurity and c.relforcerowsecurity) $$;
select is(pg_temp.tabelas_sem_rls(), 0, 'RN-101: toda tabela de public tem RLS habilitada e forçada');
create table public.tabela_sem_rls_de_teste (id int);
select is(pg_temp.tabelas_sem_rls(), 1, 'o teste detecta uma tabela nova sem RLS');
drop table public.tabela_sem_rls_de_teste;

-- Perfil criado no cadastro
select is((select count(*)::int from public.profiles where id = tests.get_supabase_uid('rls_a')), 1,
  'o cadastro cria o perfil do usuário');

-- 2. B não lê, não altera e não insere dados de A (todas as tabelas sincronizadas)
select tests.authenticate_as('rls_b');
create temporary table visiveis (t text, n int);
grant all on visiveis to authenticated;
do $$ declare t text; n int; begin
  for t in select table_name from app.sync_tables loop
    execute format('select count(*) from public.%I where user_id <> (select auth.uid())', t) into n;
    insert into visiveis values (t, n);
  end loop;
end $$;
select is((select coalesce(sum(n), 0)::int from visiveis), 0, 'US-02: B não lê nenhuma linha de A em nenhuma tabela sincronizada');
select is((select count(*)::int from visiveis), 19, 'a verificação cobre as 19 tabelas sincronizadas');
select is((select count(*)::int from public.notification_outbox), 0, 'US-02: B não lê a fila de notificações de A');
select is((select count(*)::int from public.push_subscriptions), 0, 'US-02: B não lê inscrições de push de outros');

update public.accounts set name = 'Invadida' where id = 'a1000000-0000-4000-8000-000000000001';
select tests.authenticate_as('rls_a');
select is((select name from public.accounts where id = 'a1000000-0000-4000-8000-000000000001'), 'Conta de A',
  'US-02: B não altera a conta de A');
select tests.authenticate_as('rls_b');

select throws_ok($$
  insert into public.accounts (id, user_id, name, type)
  values ('b1000000-0000-4000-8000-000000000001', tests.get_supabase_uid('rls_a'), 'Plantada', 'checking')
$$, '42501', null, 'US-02: B não insere linha em nome de A');
select throws_ok($$ delete from public.accounts where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'cliente não apaga fisicamente (só soft delete)');
select lives_ok($$
  insert into public.accounts (id, name, type) values ('b1000000-0000-4000-8000-000000000002', 'Conta de B', 'checking')
$$, 'B insere a própria conta (user_id padrão = auth.uid())');

-- 3. FK composta cruzada
select throws_ok($$
  insert into public.transactions (id, kind, amount_cents, occurred_on, payment_method, account_id)
  values ('b1000000-0000-4000-8000-000000000003', 'expense', 100, '2026-11-05', 'pix', 'a1000000-0000-4000-8000-000000000001')
$$, '23503', null, 'US-02: B não referencia a conta de A (foreign_key_violation)');

-- 4. Tabelas só do servidor
select tests.authenticate_as('rls_a');
select is((select count(*)::int from public.bank_connections), 1, 'A lê a própria conexão bancária');
select throws_ok($$
  insert into public.bank_connections (id, user_id, external_item_id, status)
  values (gen_random_uuid(), (select auth.uid()), 'item-forjado', 'UPDATED')
$$, '42501', null, 'cliente não escreve em bank_connections');
select throws_ok($$ update public.external_accounts set is_ignored = true $$,
  '42501', null, 'cliente não escreve em external_accounts diretamente');
select throws_ok($$
  insert into public.notification_outbox (user_id, kind, dedupe_key, payload)
  values ((select auth.uid()), 'x', 'x', '{}')
$$, '42501', null, 'cliente não escreve em notification_outbox');
select lives_ok($$ select public.map_external_account('a1000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000001', null, false) $$,
  'map_external_account funciona para o dono');
select is((select account_id from public.external_accounts where id = 'a1000000-0000-4000-8000-000000000004'),
  'a1000000-0000-4000-8000-000000000001'::uuid, 'o mapeamento foi gravado');
select tests.authenticate_as('rls_b');
select throws_ok($$ select public.map_external_account('a1000000-0000-4000-8000-000000000004', null, null, true) $$,
  'P0002', null, 'map_external_account não funciona para outro usuário');

-- 7. Schema app fechado (exceto a leitura do registro de tabelas, D-008)
select throws_ok($$ select count(*) from app.row_history $$, '42501', null, 'authenticated não lê app.row_history');
select throws_ok($$ insert into app.allowed_emails values ('x@example.test') $$, '42501', null,
  'authenticated não escreve em app.allowed_emails');
select ok((select count(*) from app.sync_tables) > 0, 'authenticated lê app.sync_tables (D-008)');

-- anon não lê nada
select tests.clear_authentication();
select throws_ok($$ select count(*) from public.accounts $$, '42501', null, 'anon não lê public.accounts');
select throws_ok($$ select count(*) from public.transactions $$, '42501', null, 'anon não lê public.transactions');

-- 8. Hook de cadastro (allowlist)
reset role;
insert into app.allowed_emails values ('pessoa.permitida@example.test');
select is(public.hook_before_user_created('{"user":{"email":"Pessoa.Permitida@example.test"}}'::jsonb), '{}'::jsonb,
  'US-01: e-mail da allowlist pode criar conta (sem diferenciar maiúsculas)');
select is(public.hook_before_user_created('{"user":{"email":"intrusa@example.test"}}'::jsonb) -> 'error' ->> 'message',
  'Este app é de uso privado.', 'US-01: e-mail fora da allowlist é recusado com a mensagem do produto');

select * from finish();
rollback;
