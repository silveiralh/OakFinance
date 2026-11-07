-- RPCs do reminders-tick (T-064, tech §6.4.5): só service_role executa; leitura por usuário no fuso do perfil;
-- gravação idempotente de notices + notification_outbox (RN-86); fila com skip locked e lease; registro do envio
-- (404/410 desativa a inscrição) e do job em app.job_runs (ops_health).
begin;
select plan(19);

select tests.create_supabase_user('tick_a');

create function pg_temp.uid() returns uuid language sql as $$ select tests.get_supabase_uid('tick_a') $$;

insert into public.cards (id, user_id, name, closing_day, due_day)
values ('c4000000-0000-5000-8000-000000000001', pg_temp.uid(), 'Nubank', 3, 10);
insert into public.invoices (id, user_id, card_id, reference_month, closing_date, due_date)
values ('14000000-0000-5000-8000-000000000001', pg_temp.uid(), 'c4000000-0000-5000-8000-000000000001',
        '2026-12-01', '2026-12-03', '2026-12-10'),
       -- fora da janela (vence em 2027): não entra no snapshot
       ('14000000-0000-5000-8000-000000000002', pg_temp.uid(), 'c4000000-0000-5000-8000-000000000001',
        '2027-03-01', '2027-03-03', '2027-03-10');
insert into public.transactions (id, user_id, kind, amount_cents, occurred_on, payment_method, card_id, invoice_id,
                                 source, created_at)
values ('74000000-0000-5000-8000-000000000001', pg_temp.uid(), 'expense', 98000, '2026-11-20', 'credit',
        'c4000000-0000-5000-8000-000000000001', '14000000-0000-5000-8000-000000000001', 'pluggy',
        '2026-11-20 15:00:00+00'),
       -- lançamento manual às 08:00 de 07/12 em São Paulo (11:00 UTC)
       ('74000000-0000-5000-8000-000000000002', pg_temp.uid(), 'expense', 1500, '2026-12-07', 'credit',
        'c4000000-0000-5000-8000-000000000001', '14000000-0000-5000-8000-000000000001', 'manual',
        '2026-12-07 11:00:00+00');
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, platform)
values ('54000000-0000-4000-8000-000000000001', pg_temp.uid(), 'https://push.example.test/sub/1', 'p', 'a', 'android');

-- privilégios: o app (authenticated/anon) não executa nenhuma das RPCs
select ok(not has_function_privilege('authenticated', 'public.reminders_tick_snapshot(timestamptz)', 'execute'),
  'authenticated não lê o snapshot de todos os usuários');
select ok(not has_function_privilege('anon', 'public.reminders_tick_claim(timestamptz, int)', 'execute'),
  'anon não pega a fila');
select ok(not has_function_privilege('authenticated', 'public.reminders_tick_save(uuid, jsonb, jsonb)', 'execute'),
  'authenticated não grava avisos de outro usuário');
select ok(has_function_privilege('service_role', 'public.reminders_tick_record(timestamptz, jsonb, jsonb)', 'execute'),
  'service_role executa as RPCs do tick');

-- snapshot às 09:05 de 07/12/2026 em São Paulo (12:05 UTC)
create temp table snap as
  select s as u from jsonb_array_elements(public.reminders_tick_snapshot('2026-12-07 12:05:00+00')) s
   where s->>'userId' = pg_temp.uid()::text;

select is((select u->>'timezone' from snap), 'America/Sao_Paulo', 'snapshot traz o fuso do perfil');
select is((select jsonb_array_length(u->'invoices') from snap), 1,
  'US-40: só a fatura com vencimento na janela entra');
select is((select u->'invoices'->0->>'referenceMonth' from snap), '2026-12', 'mês de referência como YYYY-MM');
select is((select jsonb_array_length(u->'txs') from snap), 2, 'lançamentos da fatura para o saldo');
select is((select u->'loggedOn' from snap), '["2026-12-07"]'::jsonb,
  'RN-87: dia local do lançamento manual (created_at no fuso do perfil)');
select is((select (u->>'hasPush')::boolean from snap), true, 'inscrição ativa conta como push');

-- gravação idempotente
create function pg_temp.save() returns int language sql as $$
  select public.reminders_tick_save(pg_temp.uid(),
    jsonb_build_array(jsonb_build_object(
      'id', '94000000-0000-5000-8000-000000000001', 'kind', 'invoice_due',
      'dedupeKey', 'invoice_due:14000000-0000-5000-8000-000000000001:d3',
      'title', 'Fatura Nubank vence em 3 dias', 'body', 'R$ 995,00 com vencimento em 10/12.',
      'navigate', '/cartoes/c4000000-0000-5000-8000-000000000001/fatura/2026-12')),
    jsonb_build_array(jsonb_build_object(
      'kind', 'invoice_due', 'dedupeKey', 'invoice_due:14000000-0000-5000-8000-000000000001:d3',
      'payload', '{"web_push":8030}'::jsonb, 'scheduledFor', '2026-12-07 12:05:00+00'))) $$;

select is(pg_temp.save(), 1, 'RN-86: aviso e push entram na fila');
select is(pg_temp.save(), 0, 'RN-86: o mesmo dedupe_key não duplica no tick seguinte');
select is((select count(*)::int from public.notices where user_id = pg_temp.uid()), 1,
  'RN-86: um aviso na central por dedupe_key');

-- fila: pega o devido, e o lease impede pegar de novo no mesmo instante
create temp table claimed as
  select c as item from jsonb_array_elements(public.reminders_tick_claim('2026-12-07 12:05:00+00', 100)) c;
select is((select count(*)::int from claimed), 1, 'push devido sai da fila');
select is((select (item->>'attempts')::int from claimed), 1, 'tentativa contada ao pegar');
select is(public.reminders_tick_claim('2026-12-07 12:06:00+00', 100), '[]'::jsonb,
  'item em tentativa não é pego por outro tick (lease de 10 min)');

-- registro: enviado; inscrição morta (410) desativada
select public.reminders_tick_record('2026-12-07 12:05:30+00',
  jsonb_build_array(jsonb_build_object('id', (select item->>'id' from claimed), 'status', 'sent')),
  jsonb_build_array(jsonb_build_object('id', '54000000-0000-4000-8000-000000000001', 'outcome', 'gone')));

select is((public.reminders_tick_context(pg_temp.uid(), '2026-12-07 13:00:00+00')->>'sentToday')::int, 1,
  'UX 6.7: push enviados no dia local contam para o teto de 3');
select is(public.reminders_tick_context(pg_temp.uid(), '2026-12-07 13:00:00+00')->'subscriptions', '[]'::jsonb,
  'tech §6.4.4: 404/410 desativa a inscrição');

-- job_runs e ops_health
select public.reminders_tick_finish(public.reminders_tick_start(), 'ok', '{"enqueued":1}'::jsonb);
select is((public.ops_health()->>'reminders_tick_age_minutes')::int, 0,
  'ops_health enxerga o último reminders-tick');

select * from finish();
rollback;
