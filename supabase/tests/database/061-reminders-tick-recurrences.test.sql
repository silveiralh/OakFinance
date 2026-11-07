-- Snapshot do reminders-tick com as contas fixas e receitas (T-091; US-41, RN-90, RN-91, RN-34): recorrências
-- ativas com lembrete perto de hoje e os lançamentos dessas ocorrências; pausada, sem lembrete ou encerrada fica de
-- fora.
begin;
select plan(8);

select tests.create_supabase_user('tick_rec');

create function pg_temp.uid() returns uuid language sql as $$ select tests.get_supabase_uid('tick_rec') $$;

insert into public.accounts (id, user_id, name, type)
values ('a4100000-0000-5000-8000-000000000001', pg_temp.uid(), 'Conta', 'checking');

insert into public.recurrences (id, user_id, kind, description, amount_cents, is_variable_amount, account_id,
                                payment_method, frequency, day_of_month, start_on, end_on, paused_at, remind,
                                is_fixed_income)
values
  -- Luz: Pix, dia 20, valor variável
  ('e4100000-0000-5000-8000-000000000001', pg_temp.uid(), 'expense', 'Luz', 18000, true,
   'a4100000-0000-5000-8000-000000000001', 'pix', 'monthly', 20, '2026-01-20', null, null, true, false),
  -- Salário: dia 5
  ('e4100000-0000-5000-8000-000000000002', pg_temp.uid(), 'income', 'Salário', 500000, false,
   'a4100000-0000-5000-8000-000000000001', 'transfer', 'monthly', 5, '2026-01-05', null, null, true, true),
  -- pausada, sem lembrete e encerrada: fora
  ('e4100000-0000-5000-8000-000000000003', pg_temp.uid(), 'expense', 'Academia', 9000, false,
   'a4100000-0000-5000-8000-000000000001', 'pix', 'monthly', 20, '2026-01-20', null, '2026-10-01', true, false),
  ('e4100000-0000-5000-8000-000000000004', pg_temp.uid(), 'expense', 'Água', 9000, false,
   'a4100000-0000-5000-8000-000000000001', 'pix', 'monthly', 20, '2026-01-20', null, null, false, false),
  ('e4100000-0000-5000-8000-000000000005', pg_temp.uid(), 'expense', 'Curso', 9000, false,
   'a4100000-0000-5000-8000-000000000001', 'pix', 'monthly', 20, '2026-01-20', '2026-06-20', null, true, false);

insert into public.transactions (id, user_id, kind, status, amount_cents, occurred_on, payment_method, account_id,
                                 recurrence_id, recurrence_date, description)
values
  -- ocorrência da Luz de 20/11 ainda prevista (D+1 em 21/11)
  ('74100000-0000-5000-8000-000000000001', pg_temp.uid(), 'expense', 'pending', 18000, '2026-11-20', 'pix',
   'a4100000-0000-5000-8000-000000000001', 'e4100000-0000-5000-8000-000000000001', '2026-11-20', 'Luz'),
  -- ocorrência de outubro: fora da janela
  ('74100000-0000-5000-8000-000000000002', pg_temp.uid(), 'expense', 'posted', 17500, '2026-10-20', 'pix',
   'a4100000-0000-5000-8000-000000000001', 'e4100000-0000-5000-8000-000000000001', '2026-10-20', 'Luz');
insert into public.transactions (id, user_id, kind, status, amount_cents, occurred_on, payment_method, account_id,
                                 description)
values
  -- receita avulsa A receber de ontem (RN-34)
  ('74100000-0000-5000-8000-000000000003', pg_temp.uid(), 'income', 'pending', 30000, '2026-11-20', 'pix',
   'a4100000-0000-5000-8000-000000000001', 'Freela'),
  -- receita avulsa já recebida: fora
  ('74100000-0000-5000-8000-000000000004', pg_temp.uid(), 'income', 'posted', 30000, '2026-11-20', 'pix',
   'a4100000-0000-5000-8000-000000000001', 'Venda');

-- 09:05 de 21/11/2026 em São Paulo (12:05 UTC)
create temp table snap as
  select s as u from jsonb_array_elements(public.reminders_tick_snapshot('2026-11-21 12:05:00+00')) s
   where s->>'userId' = pg_temp.uid()::text;

select is((select jsonb_array_length(u->'recurrences') from snap), 2,
  'US-41: só recorrências ativas, com lembrete e ainda vigentes');
select is((select jsonb_agg(r->>'description' order by r->>'description') from snap,
           jsonb_array_elements(u->'recurrences') r), '["Luz", "Salário"]'::jsonb,
  'US-41: pausada, sem lembrete e encerrada ficam de fora');
select is((select r->>'dayOfMonth' from snap, jsonb_array_elements(u->'recurrences') r
            where r->>'description' = 'Luz'), '20', 'regra da recorrência para projetar as ocorrências');
select is((select (r->>'isVariableAmount')::boolean from snap, jsonb_array_elements(u->'recurrences') r
            where r->>'description' = 'Luz'), true, 'RN-90: valor variável vem para o "≈"');
select is((select jsonb_agg(x->>'id' order by x->>'id') from snap, jsonb_array_elements(u->'recurrenceTxs') x),
  '["74100000-0000-5000-8000-000000000001", "74100000-0000-5000-8000-000000000003"]'::jsonb,
  'RN-91/RN-34: ocorrência perto de hoje e receita avulsa pendente; fora da janela ou recebida, não');
select is((select x->>'recurrenceDate' from snap, jsonb_array_elements(u->'recurrenceTxs') x
            where x->>'id' = '74100000-0000-5000-8000-000000000001'), '2026-11-20',
  'data da ocorrência para saber se ainda está prevista');
select ok((select u ? 'invoices' and u ? 'txs' and u ? 'loggedOn' from snap),
  'as chaves da migração 09 continuam no snapshot');
select ok(not has_function_privilege('authenticated', 'public.reminders_tick_snapshot(timestamptz)', 'execute'),
  'o app continua sem executar o snapshot');

select * from finish();
rollback;
