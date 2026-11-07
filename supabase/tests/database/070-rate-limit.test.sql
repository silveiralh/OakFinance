-- rate_limit_hit (T-073, tech §7.1): conta por usuário, balde e janela; recusa parâmetros inválidos; só
-- authenticated executa.
begin;
select plan(8);

select tests.create_supabase_user('rl_a');
select tests.create_supabase_user('rl_b');

select ok(not has_function_privilege('anon', 'public.rate_limit_hit(text, int, int)', 'execute'),
  'anon não executa rate_limit_hit');
select ok(has_function_privilege('authenticated', 'public.rate_limit_hit(text, int, int)', 'execute'),
  'authenticated executa rate_limit_hit');

select tests.authenticate_as('rl_a');
select ok(public.rate_limit_hit('pluggy-link', 2, 3600), '1ª chamada dentro do limite');
select ok(public.rate_limit_hit('pluggy-link', 2, 3600), '2ª chamada dentro do limite');
select ok(not public.rate_limit_hit('pluggy-link', 2, 3600), '3ª chamada passa do limite de 2');
select ok(public.rate_limit_hit('pluggy-connect', 2, 3600), 'outro balde conta à parte');
select throws_ok($$ select public.rate_limit_hit('Balde Inválido', 2, 3600) $$, '22023', null,
  'balde fora do padrão é recusado');

select tests.authenticate_as('rl_b');
select ok(public.rate_limit_hit('pluggy-link', 2, 3600), 'o limite de A não afeta B');

select * from finish();
rollback;
