-- Helpers de teste do Supabase, compatíveis com a API do basejump/supabase-test-helpers (MIT),
-- vendorizados aqui (tech §8.3). Este arquivo roda primeiro e NÃO usa transação:
-- o schema `tests` fica disponível para os demais arquivos de teste.
-- Caminho protegido pelo guard (tech §8.6): mudanças só com o rótulo needs-owner.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;
alter default privileges in schema tests grant execute on functions to anon, authenticated, service_role;

-- Cria um usuário em auth.users identificado por `identifier` (e-mail padrão em @example.test).
create or replace function tests.create_supabase_user(
  identifier text,
  email text default null,
  phone text default null,
  metadata jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = auth, pg_temp
as $$
declare
  new_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, phone,
    raw_user_meta_data, raw_app_meta_data, created_at, updated_at
  )
  values (
    new_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    coalesce(email, new_id::text || '@example.test'),
    phone,
    jsonb_build_object('test_identifier', identifier) || coalesce(metadata, '{}'::jsonb),
    '{}'::jsonb,
    now(),
    now()
  );
  return new_id;
end;
$$;

-- Dados do usuário de teste como json (id, email, phone, metadados).
create or replace function tests.get_supabase_user(identifier text)
returns json
language plpgsql
security definer
set search_path = auth, pg_temp
as $$
declare
  user_data json;
begin
  select json_build_object(
    'id', u.id,
    'email', u.email,
    'phone', u.phone,
    'raw_user_meta_data', u.raw_user_meta_data,
    'raw_app_meta_data', u.raw_app_meta_data
  )
  into user_data
  from auth.users u
  where u.raw_user_meta_data ->> 'test_identifier' = identifier
  limit 1;

  if user_data is null or user_data ->> 'id' is null then
    raise exception 'Usuário de teste % não encontrado', identifier;
  end if;
  return user_data;
end;
$$;

create or replace function tests.get_supabase_uid(identifier text)
returns uuid
language sql
security definer
set search_path = auth, pg_temp
as $$
  select (tests.get_supabase_user(identifier) ->> 'id')::uuid;
$$;

-- Passa a agir como o usuário (papel authenticated e claims do JWT) até o fim da transação.
create or replace function tests.authenticate_as(identifier text)
returns void
language plpgsql
as $$
declare
  user_data json := tests.get_supabase_user(identifier);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', user_data ->> 'id',
      'email', user_data ->> 'email',
      'phone', user_data ->> 'phone',
      'role', 'authenticated',
      'aud', 'authenticated',
      'user_metadata', user_data -> 'raw_user_meta_data',
      'app_metadata', user_data -> 'raw_app_meta_data'
    )::text,
    true
  );
end;
$$;

create or replace function tests.authenticate_as_service_role()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end;
$$;

-- Volta ao papel anon, sem claims.
create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', null, true);
end;
$$;

-- Todas as tabelas do schema têm RLS habilitada.
create or replace function tests.rls_enabled(testing_schema text)
returns text
language sql
as $$
  select is(
    (
      select count(*)::integer
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = testing_schema
        and c.relkind in ('r', 'p')
        and not c.relrowsecurity
    ),
    0,
    format('todas as tabelas do schema %s têm RLS habilitada', testing_schema)
  );
$$;

-- A tabela tem RLS habilitada.
create or replace function tests.rls_enabled(testing_schema text, testing_table text)
returns text
language sql
as $$
  select is(
    (
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = testing_schema and c.relname = testing_table
    ),
    true,
    format('a tabela %s.%s tem RLS habilitada', testing_schema, testing_table)
  );
$$;

select plan(1);
select ok(true, 'helpers de teste instalados');
select * from finish();
