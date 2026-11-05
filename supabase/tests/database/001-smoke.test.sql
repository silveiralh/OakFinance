-- Smoke do banco local e dos helpers de teste (US-02: dados de cada pessoa são só dela).
begin;
select plan(7);

select has_schema('tests', 'o schema de helpers existe');
select has_function('tests', 'authenticate_as', array['text'], 'authenticate_as existe');

select tests.create_supabase_user('smoke_a');
select tests.create_supabase_user('smoke_b');

select isnt(
  tests.get_supabase_uid('smoke_a'),
  tests.get_supabase_uid('smoke_b'),
  'US-02: cada usuário de teste tem um id próprio'
);

select alike(
  (tests.get_supabase_user('smoke_a') ->> 'email'),
  '%@example.test',
  'e-mail de teste padrão é @example.test'
);

select tests.authenticate_as('smoke_a');
select is(current_user::text, 'authenticated', 'authenticate_as troca para o papel authenticated');
select is(auth.uid(), tests.get_supabase_uid('smoke_a'), 'US-02: auth.uid() é o usuário autenticado');

select tests.clear_authentication();
select is(current_user::text, 'anon', 'clear_authentication volta ao papel anon');

select * from finish();
rollback;
