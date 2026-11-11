-- Migração 15 — estado da conexão bancária (T-077, US-47, RN-81, RN-94). Só acréscimos:
-- 1) o snapshot do reminders-tick ganha a chave `connections` (o aviso `bank_connection` é calculado no domínio, uma
--    vez por estado pela dedupe_key `bank:<id>:<estado>`); as outras chaves ficam iguais às da migração 14;
-- 2) erro temporário da Pluggy (5xx/timeout): o `pluggy-sync` conta as falhas em `last_error` (`UPSTREAM_*`,
--    `UPSTREAM_*:2`, `:3`, `:4`) e o pg_cron `pluggy-retry` tenta de novo de hora em hora, até 3 vezes, sem avisar.

create or replace function public.reminders_tick_snapshot(p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(u.snap order by u.user_id), '[]'::jsonb)
  from (
    select p.user_id, jsonb_build_object(
      'userId', p.user_id,
      'timezone', p.timezone,
      'settings', p.settings,
      'hasPush', exists (select 1 from public.push_subscriptions s
                          where s.user_id = p.user_id and s.disabled_at is null),
      'reminders', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'kind', r.kind, 'enabled', r.enabled, 'localTime', to_char(r.local_time, 'HH24:MI'),
                 'weekday', r.weekday, 'daysBefore', to_jsonb(r.days_before),
                 'skipIfLoggedToday', r.skip_if_logged_today) order by r.kind)
          from public.reminders r
         where r.user_id = p.user_id and r.deleted_at is null), '[]'::jsonb),
      'cards', coalesce((
        select jsonb_object_agg(c.id, c.name)
          from public.cards c
         where c.user_id = p.user_id and c.deleted_at is null), '{}'::jsonb),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', i.id, 'cardId', i.card_id, 'referenceMonth', to_char(i.reference_month, 'YYYY-MM'),
                 'closingDate', i.closing_date, 'dueDate', i.due_date) order by i.due_date, i.id)
          from public.invoices i
          join public.cards c on c.user_id = i.user_id and c.id = i.card_id and c.deleted_at is null
         where i.user_id = p.user_id and i.deleted_at is null
           and i.due_date between d.today - 1 and d.today + 45), '[]'::jsonb),
      'txs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'kind', t.kind, 'status', t.status, 'amountCents', t.amount_cents,
                 'cardId', t.card_id, 'counterpartCardId', t.counterpart_card_id, 'invoiceId', t.invoice_id,
                 'reviewState', t.review_state) order by t.id)
          from public.transactions t
          join public.invoices i on i.user_id = t.user_id and i.id = t.invoice_id
         where t.user_id = p.user_id and t.deleted_at is null and i.deleted_at is null
           and i.due_date between d.today - 1 and d.today + 45), '[]'::jsonb),
      'loggedOn', coalesce((
        select jsonb_agg(distinct (t.created_at at time zone p.timezone)::date)
          from public.transactions t
         where t.user_id = p.user_id and t.source = 'manual' and t.deleted_at is null
           and t.created_at > p_now - interval '8 days' and t.created_at <= p_now), '[]'::jsonb),
      -- T-091 (RN-90, RN-91, RN-34): recorrências ativas com lembrete que podem ter ocorrência de D−3 a D+3
      'recurrences', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', r.id, 'kind', r.kind, 'description', r.description, 'amountCents', r.amount_cents,
                 'isVariableAmount', r.is_variable_amount, 'categoryId', r.category_id,
                 'accountId', r.account_id, 'cardId', r.card_id, 'paymentMethod', r.payment_method,
                 'isFixedIncome', r.is_fixed_income, 'autoPost', r.auto_post, 'remind', r.remind,
                 'frequency', r.frequency, 'intervalCount', r.interval_count, 'dayOfMonth', r.day_of_month,
                 'weekday', r.weekday, 'monthOfYear', r.month_of_year, 'startOn', r.start_on,
                 'endOn', r.end_on, 'maxOccurrences', r.max_occurrences) order by r.id)
          from public.recurrences r
         where r.user_id = p.user_id and r.deleted_at is null and r.paused_at is null and r.remind
           and r.start_on <= d.today + 3 and (r.end_on is null or r.end_on >= d.today - 3)), '[]'::jsonb),
      -- lançamentos dessas ocorrências (de D−3 a D+3) e receitas avulsas pendentes (RN-34) de D−3 a hoje
      'recurrenceTxs', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'kind', t.kind, 'status', t.status, 'amountCents', t.amount_cents,
                 'occurredOn', t.occurred_on, 'description', t.description,
                 'recurrenceId', t.recurrence_id, 'recurrenceDate', t.recurrence_date,
                 'reviewState', t.review_state) order by t.id)
          from public.transactions t
         where t.user_id = p.user_id and t.deleted_at is null
           and ((t.recurrence_id is not null and t.recurrence_date between d.today - 3 and d.today + 3)
             or (t.recurrence_id is null and t.kind = 'income' and t.status = 'pending'
                 and t.occurred_on between d.today - 3 and d.today))), '[]'::jsonb),
      -- T-092 (RN-92, RN-93): o mês orçamentário de hoje para o consumo das faixas e o resumo da semana
      'month', public.reminders_tick_month(p.user_id, d.today),
      -- T-077 (RN-81, RN-94): conexões ativas com o status da Pluggy e o fim do consentimento no fuso do usuário
      'connections', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'institution', c.institution, 'connectorName', c.connector_name,
                 'status', c.status,
                 'consentExpiresOn', (c.consent_expires_at at time zone p.timezone)::date) order by c.id)
          from public.bank_connections c
         where c.user_id = p.user_id and c.is_active and c.deleted_at is null), '[]'::jsonb)
    ) as snap
    from public.profiles p
    cross join lateral (select (p_now at time zone p.timezone)::date as today) d
    where p.deleted_at is null
  ) u;
$$;

revoke all on function public.reminders_tick_snapshot(timestamptz) from public, anon, authenticated;
grant execute on function public.reminders_tick_snapshot(timestamptz) to service_role;

-- Novas tentativas do erro temporário: 1 h depois da última execução, enquanto houver no máximo 3 falhas seguidas
-- (a 4ª falha para de tentar; a sincronização das 07:40/19:40 continua normalmente).
create or replace function app.enqueue_pluggy_retry() returns int
language plpgsql security definer set search_path = '' as $$
declare c record; n int := 0;
begin
  for c in
    select id from public.bank_connections
     where is_active and deleted_at is null
       and last_error ~ '^UPSTREAM_(UNAVAILABLE|TIMEOUT)(:[23])?$'
       and last_synced_at <= now() - interval '55 minutes'
  loop
    perform app.invoke_function('pluggy-sync', jsonb_build_object('connectionId', c.id, 'mode', 'incremental'));
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function app.enqueue_pluggy_retry() from public, anon, authenticated;

select cron.schedule('pluggy-retry', '20 * * * *', $$ select app.enqueue_pluggy_retry() $$);
