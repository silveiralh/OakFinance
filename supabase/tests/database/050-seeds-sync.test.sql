-- Seeds por usuário pelo sync (tech §3.8, T-035). US-01, RN-40: a categoria enviada pelo aparelho é aplicada
-- (a coluna gerada `name_ci` fica fora do insert) e o reenvio com o mesmo id v5 não duplica.
begin;
select plan(5);

select tests.create_supabase_user('seed_a');
select tests.authenticate_as('seed_a');

create function pg_temp.cat(p_id text, p_slug text, p_name text, p_ts text) returns jsonb
language sql as $$ select jsonb_build_object(
  'id', p_id, 'slug', p_slug, 'name', p_name, 'name_ci', 'ignorado', 'kind', 'expense', 'bucket', 'needs',
  'feeds_reserve', false, 'is_system', false, 'is_default', true, 'sort_order', 0, 'icon', 'ShoppingCart',
  'color', null, 'parent_id', null, 'archived_at', null, 'deleted_at', null, 'client_updated_at', p_ts) $$;

select ok(not ('name_ci' = any (app.writable_columns('categories'))),
  'coluna gerada fica fora das colunas graváveis');

select is(
  public.sync_push('dev-seed', jsonb_build_array(jsonb_build_object(
    'mutation_id', '05000000-0000-7000-8000-000000000001', 'table', 'categories',
    'row', pg_temp.cat('ca000000-0000-5000-8000-000000000001', 'mercado', 'Mercado', '2026-11-06T12:00:00Z'))))
    -> 'results' -> 0 ->> 'status',
  'applied', 'RN-40: categoria seed enviada pelo aparelho é aplicada');

select is((select name_ci from public.categories where id = 'ca000000-0000-5000-8000-000000000001'),
  'mercado', 'name_ci continua calculado pelo banco');

-- outro aparelho manda o mesmo seed (mesmo id v5, mutação nova): atualiza a mesma linha, sem duplicar
select is(
  public.sync_push('dev-seed-2', jsonb_build_array(jsonb_build_object(
    'mutation_id', '05000000-0000-7000-8000-000000000002', 'table', 'categories',
    'row', pg_temp.cat('ca000000-0000-5000-8000-000000000001', 'mercado', 'Mercado', '2026-11-06T12:00:01Z'))))
    -> 'results' -> 0 ->> 'status',
  'applied', 'mesmo seed de outro aparelho é aplicado na mesma linha');

select is((select count(*)::int from public.categories where slug = 'mercado'),
  1, 'US-01: seeds com id v5 não duplicam');

select * from finish();
rollback;
