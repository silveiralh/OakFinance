-- Migração 14 — alertas de limite e resumo semanal (T-092, RN-92, RN-93, US-42, US-43). O snapshot do
-- reminders-tick ganha a chave `month` (lançamentos, recorrências, contas, cartões, categorias, meses das faturas e
-- orçamentos do mês de hoje, no formato do domínio) e `loggedOn` passa a cobrir 8 dias (dias com lançamento da
-- semana, RN-93). O cálculo continua no domínio (dueNotifications). As outras chaves ficam iguais.

-- Mês orçamentário do usuário no dia local `p_today`: lançamentos do mês civil (e da semana, se ela começou no mês
-- anterior) ou de faturas que vencem no mês (RN-12: a compra no cartão conta no mês do vencimento), as recorrências
-- não excluídas (o domínio ignora as pausadas), contas, cartões e categorias não excluídos, o mês de referência de
-- cada fatura desses lançamentos e os orçamentos (padrão e do mês).
create or replace function public.reminders_tick_month(p_user uuid, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with m as (
    select date_trunc('month', p_today)::date as start,
           (date_trunc('month', p_today) + interval '1 month' - interval '1 day')::date as finish
  ), tx as (
    select t.*
      from public.transactions t, m
     where t.user_id = p_user and t.deleted_at is null
       and (t.occurred_on between least(m.start, p_today - 6) and m.finish
            or t.invoice_id in (select i.id from public.invoices i
                                 where i.user_id = p_user and i.deleted_at is null and i.reference_month = m.start))
  )
  select jsonb_build_object(
    'txs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'kind', t.kind, 'status', t.status, 'countBeforeReceived', t.count_before_received,
               'invoicePinned', t.invoice_pinned, 'amountCents', t.amount_cents, 'occurredOn', t.occurred_on,
               'description', null, 'categoryId', t.category_id, 'paymentMethod', t.payment_method,
               'accountId', t.account_id, 'cardId', t.card_id, 'invoiceId', t.invoice_id,
               'counterpartAccountId', t.counterpart_account_id, 'counterpartCardId', t.counterpart_card_id,
               'seriesId', t.series_id, 'installmentNumber', t.installment_number,
               'installmentCount', t.installment_count, 'recurrenceId', t.recurrence_id,
               'recurrenceDate', t.recurrence_date, 'goalId', t.goal_id, 'incomeExpected', t.income_expected,
               'source', t.source, 'externalId', t.external_id, 'reviewState', t.review_state,
               'duplicateOf', t.duplicate_of, 'merchantCnpj', t.merchant_cnpj, 'deletedAt', null) order by t.id)
        from tx t), '[]'::jsonb),
    'recurrences', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'kind', r.kind, 'description', r.description, 'amountCents', r.amount_cents,
               'isVariableAmount', r.is_variable_amount, 'categoryId', r.category_id,
               'accountId', r.account_id, 'cardId', r.card_id, 'paymentMethod', r.payment_method,
               'isFixedIncome', r.is_fixed_income, 'autoPost', r.auto_post, 'remind', r.remind,
               'pausedAt', r.paused_at, 'frequency', r.frequency, 'intervalCount', r.interval_count,
               'dayOfMonth', r.day_of_month, 'weekday', r.weekday, 'monthOfYear', r.month_of_year,
               'startOn', r.start_on, 'endOn', r.end_on, 'maxOccurrences', r.max_occurrences) order by r.id)
        from public.recurrences r
       where r.user_id = p_user and r.deleted_at is null), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'type', a.type, 'isRestricted', a.is_restricted,
               'includeInSpendable', a.include_in_spendable, 'initialBalanceCents', a.initial_balance_cents,
               'initialBalanceOn', a.initial_balance_on) order by a.id)
        from public.accounts a
       where a.user_id = p_user and a.deleted_at is null), '[]'::jsonb),
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'closingDay', c.closing_day, 'dueDay', c.due_day,
               'closingDayRule', c.closing_day_rule, 'limitCents', c.limit_cents,
               'paymentAccountId', c.payment_account_id) order by c.id)
        from public.cards c
       where c.user_id = p_user and c.deleted_at is null), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'parentId', c.parent_id, 'kind', c.kind, 'bucket', c.bucket,
               'slug', c.slug, 'feedsReserve', c.feeds_reserve, 'isSystem', c.is_system) order by c.id)
        from public.categories c
       where c.user_id = p_user and c.deleted_at is null), '[]'::jsonb),
    'invoiceMonths', coalesce((
      select jsonb_object_agg(i.id, to_char(i.reference_month, 'YYYY-MM'))
        from public.invoices i
       where i.user_id = p_user and i.deleted_at is null
         and i.id in (select t.invoice_id from tx t where t.invoice_id is not null)), '{}'::jsonb),
    'budgets', coalesce((
      select jsonb_agg(jsonb_build_object(
               'month', to_char(b.month, 'YYYY-MM'), 'scope', b.scope, 'bucket', b.bucket,
               'categoryId', b.category_id, 'pctBp', b.pct_bp, 'limitCents', b.limit_cents,
               'alertThresholdsBp', to_jsonb(b.alert_thresholds_bp)) order by b.id)
        from public.budgets b
       where b.user_id = p_user and b.deleted_at is null), '[]'::jsonb)
  );
$$;

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
      'month', public.reminders_tick_month(p.user_id, d.today)
    ) as snap
    from public.profiles p
    cross join lateral (select (p_now at time zone p.timezone)::date as today) d
    where p.deleted_at is null
  ) u;
$$;

revoke all on function public.reminders_tick_month(uuid, date), public.reminders_tick_snapshot(timestamptz)
  from public, anon, authenticated;
grant execute on function public.reminders_tick_month(uuid, date), public.reminders_tick_snapshot(timestamptz)
  to service_role;
