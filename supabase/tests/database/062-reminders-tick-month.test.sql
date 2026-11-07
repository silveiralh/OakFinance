-- Mês orçamentário no snapshot do reminders-tick (T-092; US-42, US-43, RN-92, RN-93): lançamentos do mês e da
-- semana, compras no cartão pela fatura que vence no mês (RN-12), categorias com nome, orçamentos e os dias com
-- lançamento da semana.
begin;
select plan(9);

select tests.create_supabase_user('tick_month');

create function pg_temp.uid() returns uuid language sql as $$ select tests.get_supabase_uid('tick_month') $$;

insert into public.accounts (id, user_id, name, type)
values ('a4200000-0000-5000-8000-000000000001', pg_temp.uid(), 'Conta', 'checking');
insert into public.cards (id, user_id, name, closing_day, due_day)
values ('c4200000-0000-5000-8000-000000000001', pg_temp.uid(), 'Cartão', 3, 10);
insert into public.invoices (id, user_id, card_id, reference_month, closing_date, due_date)
values ('14200000-0000-5000-8000-000000000001', pg_temp.uid(), 'c4200000-0000-5000-8000-000000000001',
        '2026-11-01', '2026-11-03', '2026-11-10');
insert into public.categories (id, user_id, name, kind, bucket)
values ('ca200000-0000-5000-8000-000000000001', pg_temp.uid(), 'Lazer de teste', 'expense', 'wants');
insert into public.budgets (id, user_id, month, scope, bucket, pct_bp)
values ('b4200000-0000-5000-8000-000000000001', pg_temp.uid(), null, 'bucket', 'wants', 3000);

insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id, card_id,
                                 invoice_id, category_id, created_at)
values
  -- no mês
  ('74200000-0000-5000-8000-000000000001', pg_temp.uid(), 'expense', 1000, '2026-11-02', 'pix',
   'a4200000-0000-5000-8000-000000000001', null, null, 'ca200000-0000-5000-8000-000000000001',
   '2026-11-02 12:00:00+00'),
  -- compra de outubro na fatura que vence em novembro (RN-12)
  ('74200000-0000-5000-8000-000000000002', pg_temp.uid(), 'expense', 2000, '2026-10-20', 'credit',
   null, 'c4200000-0000-5000-8000-000000000001', '14200000-0000-5000-8000-000000000001', null,
   '2026-10-20 12:00:00+00'),
  -- segunda 26/10: entra só na semana que termina em 01/11
  ('74200000-0000-5000-8000-000000000004', pg_temp.uid(), 'expense', 500, '2026-10-26', 'pix',
   'a4200000-0000-5000-8000-000000000001', null, null, null, '2026-10-26 12:00:00+00'),
  -- fora do mês e de fatura do mês
  ('74200000-0000-5000-8000-000000000003', pg_temp.uid(), 'expense', 3000, '2026-10-10', 'pix',
   'a4200000-0000-5000-8000-000000000001', null, null, null, '2026-10-10 12:00:00+00');

-- 19:05 de domingo 01/11/2026 em São Paulo (22:05 UTC): a semana começou em 26/10
create temp table snap as
  select s as u from jsonb_array_elements(public.reminders_tick_snapshot('2026-11-01 22:05:00+00')) s
   where s->>'userId' = pg_temp.uid()::text;
-- 09:05 de 02/11/2026 em São Paulo
create temp table snap2 as
  select s as u from jsonb_array_elements(public.reminders_tick_snapshot('2026-11-02 12:05:00+00')) s
   where s->>'userId' = pg_temp.uid()::text;

select ok((select u ? 'month' from snap), 'snapshot traz o mês orçamentário');
select is((select jsonb_agg(t->>'id' order by t->>'id') from snap2, jsonb_array_elements(u->'month'->'txs') t),
  '["74200000-0000-5000-8000-000000000001", "74200000-0000-5000-8000-000000000002"]'::jsonb,
  'RN-12: lançamentos do mês e a compra de outubro na fatura que vence em novembro');
select is((select jsonb_agg(t->>'id' order by t->>'id') from snap, jsonb_array_elements(u->'month'->'txs') t),
  '["74200000-0000-5000-8000-000000000001", "74200000-0000-5000-8000-000000000002", "74200000-0000-5000-8000-000000000004"]'::jsonb,
  'RN-93: no domingo 01/11 a semana começou em 26/10, e o lançamento dela entra');
select is((select u->'month'->'invoiceMonths'->>'14200000-0000-5000-8000-000000000001' from snap2), '2026-11',
  'mês da fatura pelo vencimento');
select is((select t->>'description' from snap2, jsonb_array_elements(u->'month'->'txs') t limit 1), null,
  'descrição dos lançamentos não sai do banco (o cálculo não precisa)');
select is((select c->>'name' from snap2, jsonb_array_elements(u->'month'->'categories') c
            where c->>'id' = 'ca200000-0000-5000-8000-000000000001'), 'Lazer de teste',
  'US-43: nome das categorias para as 3 maiores');
select is((select (b->>'pctBp')::int from snap2, jsonb_array_elements(u->'month'->'budgets') b
            where b->>'bucket' = 'wants'), 3000, 'RN-43: percentuais do orçamento');
select is((select jsonb_array_length(u->'month'->'accounts') from snap2), 1, 'contas para o cálculo');
select ok(not has_function_privilege('authenticated', 'public.reminders_tick_month(uuid, date)', 'execute'),
  'o app não executa a leitura do mês de outro usuário');

select * from finish();
rollback;
