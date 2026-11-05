-- Sync no banco (tech §4.7, §4.10 e §8.3 itens 5–6). US-04 (offline e sincronização),
-- RN-95..RN-99 (outbox, push/pull, conflitos com histórico).
begin;
select plan(36);

select tests.create_supabase_user('sync_a');
select tests.create_supabase_user('sync_b');

-- Linha completa de conta, como o cliente envia (tech §4.4: a mutação é a linha inteira)
create temporary table conta (doc jsonb);
grant select on conta to authenticated;
insert into conta values (jsonb_build_object(
  'id', 'c1000000-0000-4000-8000-000000000001', 'name', 'Conta corrente', 'type', 'checking',
  'initial_balance_cents', 0, 'initial_balance_on', '2026-11-01', 'is_restricted', false,
  'include_in_spendable', true, 'sort_order', 0, 'client_updated_at', '2026-11-05T12:00:00Z'));

create function pg_temp.mut(p_id text, p_table text, p_row jsonb) returns jsonb
language sql as $$ select jsonb_build_object('mutation_id', p_id, 'table', p_table, 'row', p_row) $$;

create function pg_temp.tx(p_id text, p_account text, p_cents int) returns jsonb
language sql as $$ select jsonb_build_object(
  'id', p_id, 'kind', 'expense', 'status', 'posted', 'amount_cents', p_cents, 'occurred_on', '2026-11-05',
  'payment_method', 'pix', 'account_id', p_account, 'category_source', 'manual', 'invoice_pinned', false,
  'income_expected', false, 'count_before_received', false, 'source', 'manual', 'review_state', 'ok',
  'matched_external', false, 'tags', '{}', 'client_updated_at', '2026-11-05T12:00:00Z') $$;

select tests.authenticate_as('sync_a');

-- applied
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000001', 'accounts', (select doc from conta))))
    -> 'results' -> 0 ->> 'status',
  'applied', 'RN-95: mutação nova é aplicada');
select ok((select server_version > 0 from public.accounts where id = 'c1000000-0000-4000-8000-000000000001'),
  'server_version é atribuído pelo servidor');
select is((select user_id from public.accounts where id = 'c1000000-0000-4000-8000-000000000001'),
  tests.get_supabase_uid('sync_a'), 'user_id vem de auth.uid(), não do cliente');
select is((select device_id from public.accounts where id = 'c1000000-0000-4000-8000-000000000001'),
  'dev-a', 'device_id vem do parâmetro do push');

-- duplicate
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000001', 'accounts', (select doc from conta))))
    -> 'results' -> 0 ->> 'status',
  'duplicate', 'US-04: a mesma mutação reenviada vira duplicate, sem efeito');

-- update mais novo: applied, server_version cresce e o histórico guarda a versão anterior
create temporary table versao (v bigint);
grant all on versao to authenticated;
insert into versao select server_version from public.accounts where id = 'c1000000-0000-4000-8000-000000000001';
select is(
  public.sync_push('dev-b', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000002', 'accounts',
    (select doc from conta) || '{"name":"Conta principal","client_updated_at":"2026-11-05T13:00:00Z"}')))
    -> 'results' -> 0 ->> 'status',
  'applied', 'edição mais nova é aplicada');
select ok((select server_version from public.accounts where id = 'c1000000-0000-4000-8000-000000000001')
          > (select v from versao), 'server_version cresce a cada escrita');

-- stale: escrita mais antiga perde (LWW) e fica no histórico
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000003', 'accounts',
    (select doc from conta) || '{"name":"Nome antigo","client_updated_at":"2026-11-05T12:30:00Z"}')))
    -> 'results' -> 0 ->> 'status',
  'stale', 'RN-97: edição mais antiga recebe stale');
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000004', 'accounts',
    (select doc from conta) || '{"name":"Nome antigo 2","client_updated_at":"2026-11-05T12:30:00Z"}')))
    -> 'results' -> 0 -> 'row' ->> 'name',
  'Conta principal', 'stale devolve a linha atual do servidor');
select is((select name from public.accounts where id = 'c1000000-0000-4000-8000-000000000001'),
  'Conta principal', 'a linha do servidor não muda com a escrita velha');
select ok(array_length(public.get_row_history('accounts', 'c1000000-0000-4000-8000-000000000001'), 1) >= 3,
  'RN-98: histórico guarda a versão substituída e as escritas perdedoras');
select ok(exists (select 1 from unnest(public.get_row_history('accounts', 'c1000000-0000-4000-8000-000000000001')) h
                   where h ->> 'op' = 'stale_write' and h -> 'rejected_row' ->> 'name' = 'Nome antigo'),
  'RN-98: stale_write registra a escrita rejeitada');

-- exclusão e restauração (A exclui, B edita depois: a linha volta)
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000005', 'accounts',
    (select doc from conta) || '{"name":"Conta principal","deleted_at":"2026-11-05T14:00:00Z","client_updated_at":"2026-11-05T14:00:00Z"}')))
    -> 'results' -> 0 ->> 'status', 'applied', 'exclusão (soft delete) é aplicada');
select is(
  public.sync_push('dev-b', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000006', 'accounts',
    (select doc from conta) || '{"name":"Conta principal","client_updated_at":"2026-11-05T15:00:00Z"}')))
    -> 'results' -> 0 ->> 'status', 'applied', 'edição posterior restaura a linha');
select ok(exists (select 1 from unnest(public.get_row_history('accounts', 'c1000000-0000-4000-8000-000000000001')) h where h ->> 'op' = 'delete')
      and exists (select 1 from unnest(public.get_row_history('accounts', 'c1000000-0000-4000-8000-000000000001')) h where h ->> 'op' = 'restore'),
  'histórico registra delete e restore');

-- rejected: check e FK
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000007', 'accounts',
    (select doc from conta) || '{"id":"c1000000-0000-4000-8000-000000000002","type":"credit_card"}')))
    -> 'results' -> 0 ->> 'code',
  '23514', 'check violado vira rejected com o sqlstate');
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000008', 'transactions',
    pg_temp.tx('d1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000ff', 1000))))
    -> 'results' -> 0 ->> 'code',
  '23503', 'filho sem o pai vira rejected por FK');
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000009', 'transactions',
    pg_temp.tx('d1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 0))))
    -> 'results' -> 0 ->> 'status',
  'rejected', 'RN-01: valor zero é rejected no push');
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-000000000009', 'transactions',
    pg_temp.tx('d1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 500))))
    -> 'results' -> 0 ->> 'status',
  'duplicate', 'mutação rejected reenviada com o mesmo id vira duplicate (o cliente gera id novo)');

-- TABLE_NOT_WRITABLE
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-00000000000a', 'bank_connections',
    '{"id":"e1000000-0000-4000-8000-000000000001"}'::jsonb)))
    -> 'results' -> 0 ->> 'code',
  'TABLE_NOT_WRITABLE', 'tabela só do servidor recusa escrita do cliente');

-- Ordem pai → filho no mesmo lote (filho listado antes)
select is(
  (select array_agg(r ->> 'status' order by r ->> 'mutation_id') from jsonb_array_elements(
    public.sync_push('dev-a', jsonb_build_array(
      pg_temp.mut('01000000-0000-7000-8000-00000000000b', 'transactions',
          pg_temp.tx('d1000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 2500)),
      pg_temp.mut('01000000-0000-7000-8000-00000000000c', 'accounts',
          (select doc from conta) || '{"id":"c1000000-0000-4000-8000-000000000003","name":"Carteira","type":"cash"}')))
    -> 'results') r),
  array['applied', 'applied'], 'push_order aplica o pai antes do filho');

-- Relógio adiantado
select is(
  public.sync_push('dev-a', jsonb_build_array(pg_temp.mut('01000000-0000-7000-8000-00000000000d', 'transactions',
    pg_temp.tx('d1000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001', 700)
      || '{"client_updated_at":"2100-01-01T00:00:00Z"}')))
    -> 'results' -> 0 ->> 'status', 'applied', 'escrita com relógio adiantado é aceita');
select ok((select client_updated_at <= now() + interval '5 minutes' from public.transactions
            where id = 'd1000000-0000-4000-8000-000000000004'),
  'client_updated_at futuro é limitado a now() + 5 min');

-- Lote grande demais
select throws_ok(
  $$ select public.sync_push('dev-a', (select jsonb_agg(pg_temp.mut(gen_random_uuid()::text, 'accounts', '{}'::jsonb))
                                       from generate_series(1, 201))) $$,
  '22023', null, 'lote com mais de 200 mutações é recusado');

-- Pull por cursor com paginação
select is((public.sync_pull(0, 2) ->> 'has_more')::boolean, true, 'RN-96: pull pagina e indica has_more');
select is(jsonb_array_length(public.sync_pull(0, 2) -> 'rows'), 2, 'pull respeita o limite da página');
select is(
  (select count(*)::int from jsonb_array_elements(
     public.sync_pull((public.sync_pull(0, 2) ->> 'next')::bigint, 1000) -> 'rows')),
  (select count(*)::int - 2 from app.v_sync_rows where user_id = tests.get_supabase_uid('sync_a')),
  'a página seguinte começa depois do cursor, sem repetir');
select is((public.sync_pull(1000000000, 10) ->> 'has_more')::boolean, false, 'cursor no fim: sem mais linhas');

-- Isolamento: B não sobrescreve nem lê a linha de A
select tests.authenticate_as('sync_b');
select is(
  public.sync_push('dev-x', jsonb_build_array(pg_temp.mut('02000000-0000-7000-8000-000000000001', 'accounts',
    (select doc from conta) || '{"name":"Invasão","client_updated_at":"2026-12-01T00:00:00Z"}')))
    -> 'results' -> 0 ->> 'code',
  'FOREIGN_ROW', 'US-02: linha de outro usuário vira rejected FOREIGN_ROW');
select is(jsonb_array_length(public.sync_pull(0, 500) -> 'rows'), 0, 'US-02: B não recebe linhas de A no pull');
select is(cardinality(public.get_row_history('accounts', 'c1000000-0000-4000-8000-000000000001')), 0,
  'US-02: B não vê o histórico de A');

-- Horizonte de expurgo e campos imutáveis (como postgres)
reset role;
update app.sync_config set purge_horizon_version = 1000000;
select tests.authenticate_as('sync_a');
select is((public.sync_pull(5, 10) ->> 'reset_required')::boolean, true, 'RN-99: cursor anterior ao horizonte pede reset');
reset role;
select throws_ok(
  $$ update public.accounts set user_id = tests.get_supabase_uid('sync_b'), client_updated_at = now()
      where id = 'c1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'user_id é imutável');
update public.accounts set created_at = '2000-01-01', client_updated_at = now() + interval '1 minute'
 where id = 'c1000000-0000-4000-8000-000000000001';
select isnt((select created_at from public.accounts where id = 'c1000000-0000-4000-8000-000000000001'),
  '2000-01-01'::timestamptz, 'created_at é imutável');

-- Sem sessão
select tests.clear_authentication();
select throws_ok($$ select public.sync_push('dev', '[]'::jsonb) $$, '42501', null, 'anon não executa sync_push');
select ok(public.ping() is not null, 'ping responde para anon (keepalive)');

select * from finish();
rollback;
