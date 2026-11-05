-- Checks de domínio no banco (tech §8.3 item 9) e FKs compostas por usuário (US-02).
-- RN-01 (centavos positivos), RN-05 (status), RN-07 (contas), RN-09 (parâmetros do cartão).
begin;
select plan(19);

select tests.create_supabase_user('core_a');
select tests.create_supabase_user('core_b');

-- Dados mínimos de A (como postgres; a RLS entra na migração 05)
insert into public.accounts (id, user_id, name, type)
values ('a0000000-0000-4000-8000-000000000001', tests.get_supabase_uid('core_a'), 'Conta corrente', 'checking');
insert into public.cards (id, user_id, name, closing_day, due_day)
values ('a0000000-0000-4000-8000-000000000002', tests.get_supabase_uid('core_a'), 'Cartão', 3, 10);
insert into public.invoices (id, user_id, card_id, reference_month, closing_date, due_date)
values ('a0000000-0000-4000-8000-000000000003', tests.get_supabase_uid('core_a'),
        'a0000000-0000-4000-8000-000000000002', '2026-12-01', '2026-12-03', '2026-12-10');
insert into public.accounts (id, user_id, name, type)
values ('b0000000-0000-4000-8000-000000000001', tests.get_supabase_uid('core_b'), 'Conta de B', 'checking');

-- Lançamento válido de referência
select lives_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id)
  values ('a0000000-0000-4000-8000-000000000010', tests.get_supabase_uid('core_a'), 'expense', 1990, '2026-11-05', 'pix',
          'a0000000-0000-4000-8000-000000000001')
$$, 'RN-01: despesa de R$ 19,90 em centavos é aceita');

-- RN-01: valor ≤ 0 é recusado
select throws_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', 0, '2026-11-05', 'pix',
          'a0000000-0000-4000-8000-000000000001')
$$, '23514', null, 'RN-01: valor zero é recusado');
select throws_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', -100, '2026-11-05', 'pix',
          'a0000000-0000-4000-8000-000000000001')
$$, '23514', null, 'RN-01: valor negativo é recusado (o sentido vem do kind)');
select throws_ok($$
  insert into public.recurrences (id, user_id, kind, description, amount_cents, payment_method, frequency, day_of_month, start_on, account_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', 'Aluguel', 0, 'pix', 'monthly', 5, '2026-11-01',
          'a0000000-0000-4000-8000-000000000001')
$$, '23514', null, 'RN-01: recorrência com valor zero é recusada');

-- Cartão sem fatura
select throws_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, card_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', 5000, '2026-11-05', 'credit',
          'a0000000-0000-4000-8000-000000000002')
$$, '23514', null, 'compra no cartão sem fatura é recusada');
select lives_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, card_id, invoice_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', 5000, '2026-11-05', 'credit',
          'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003')
$$, 'compra no cartão com fatura é aceita');
select throws_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id, card_id, invoice_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', 5000, '2026-11-05', 'credit',
          'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003')
$$, '23514', null, 'lançamento com conta e cartão ao mesmo tempo é recusado');

-- Transferência sem contraparte
select throws_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'transfer', 1000, '2026-11-05', 'transfer',
          'a0000000-0000-4000-8000-000000000001')
$$, '23514', null, 'transferência sem contraparte é recusada');
select throws_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id, counterpart_account_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', 1000, '2026-11-05', 'pix',
          'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001')
$$, '23514', null, 'despesa com contraparte é recusada');
select lives_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id, counterpart_card_id, invoice_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'transfer', 5000, '2026-12-10', 'transfer',
          'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003')
$$, 'pagamento de fatura (transfer para o cartão) é aceito');

-- Parcela fora da faixa
select throws_ok($$
  insert into public.installment_plans (id, user_id, description, card_id, purchase_date, total_cents, installments_count)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'TV', 'a0000000-0000-4000-8000-000000000002', '2026-11-05', 300000, 49)
$$, '23514', null, 'série com mais de 48 parcelas é recusada');
select throws_ok($$
  insert into public.installment_plans (id, user_id, description, card_id, purchase_date, total_cents, installments_count)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'TV', 'a0000000-0000-4000-8000-000000000002', '2026-11-05', 300000, 1)
$$, '23514', null, 'série com uma parcela só é recusada');
insert into public.installment_plans (id, user_id, description, card_id, purchase_date, total_cents, installments_count)
values ('a0000000-0000-4000-8000-000000000020', tests.get_supabase_uid('core_a'), 'TV', 'a0000000-0000-4000-8000-000000000002', '2026-11-05', 300000, 3);
select throws_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, card_id, invoice_id, series_id, installment_number, installment_count, source)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', 100000, '2026-11-05', 'credit',
          'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003',
          'a0000000-0000-4000-8000-000000000020', 4, 3, 'installment')
$$, '23514', null, 'parcela 4 de 3 é recusada');

-- RN-05: status fora do vocabulário
select throws_ok($$
  insert into public.transactions (id, user_id, kind, status, amount_cents, occurred_on, payment_method, account_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'expense', 'prevista', 1000, '2026-11-05', 'pix',
          'a0000000-0000-4000-8000-000000000001')
$$, '23514', null, 'RN-05: "prevista" é derivada, não é status gravado');

-- RN-07: nome e tipo da conta
select throws_ok($$
  insert into public.accounts (id, user_id, name, type)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), '', 'checking')
$$, '23514', null, 'RN-07: conta sem nome é recusada');
select throws_ok($$
  insert into public.accounts (id, user_id, name, type)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'Cartão', 'credit_card')
$$, '23514', null, 'RN-07: cartão não é tipo de conta (fica em cards)');

-- RN-09: dias do cartão e regra do dia de fechamento
select throws_ok($$
  insert into public.cards (id, user_id, name, closing_day, due_day)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'Cartão', 32, 10)
$$, '23514', null, 'RN-09: dia de fechamento fora de 1–31 é recusado');
select throws_ok($$
  insert into public.cards (id, user_id, name, closing_day, due_day, closing_day_rule)
  values (gen_random_uuid(), tests.get_supabase_uid('core_a'), 'Cartão', 3, 10, 'atual')
$$, '23514', null, 'RN-09: regra do dia de fechamento só aceita next/same');

-- US-02: FK composta impede referenciar a conta de outro usuário
select throws_ok($$
  insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, account_id)
  values (gen_random_uuid(), tests.get_supabase_uid('core_b'), 'expense', 1000, '2026-11-05', 'pix',
          'a0000000-0000-4000-8000-000000000001')
$$, '23503', null, 'US-02: B não referencia a conta de A');

select * from finish();
rollback;
