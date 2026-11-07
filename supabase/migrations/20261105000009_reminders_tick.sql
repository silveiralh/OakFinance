-- Migração 09 — reminders-tick (T-064, tech §6.4.5). RPCs usadas só pela Edge Function `reminders-tick`, que roda
-- com a chave secreta (service_role). O cálculo do que é devido fica no domínio (dueNotifications); aqui ficam a
-- leitura por usuário, a gravação idempotente (notices + notification_outbox), a fila com `for update skip locked`
-- e o registro em app.job_runs. Execução: só service_role.

-- Abre a execução em app.job_runs (o ops_health olha a idade do último 'ok'/'partial').
create or replace function public.reminders_tick_start() returns bigint
language sql security definer set search_path = '' as $$
  insert into app.job_runs (job, status) values ('reminders-tick', 'running') returning id;
$$;

create or replace function public.reminders_tick_finish(p_run bigint, p_status text, p_stats jsonb, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update app.job_runs
     set finished_at = now(), status = p_status, stats = coalesce(p_stats, '{}'::jsonb), error = p_error
   where id = p_run and job = 'reminders-tick';
$$;

-- Estado de cada usuário necessário para os lembretes de fatura e o diário (todos os usuários: a central de avisos
-- vale com ou sem push, RN-86). Faturas com vencimento de ontem até 45 dias à frente (cobre D−3/D0 e o fechamento),
-- os lançamentos dessas faturas (para o saldo) e os dias locais com lançamento manual criado nos últimos 3 dias.
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
           and t.created_at > p_now - interval '3 days' and t.created_at <= p_now), '[]'::jsonb)
    ) as snap
    from public.profiles p
    cross join lateral (select (p_now at time zone p.timezone)::date as today) d
    where p.deleted_at is null
  ) u;
$$;

-- Grava os avisos (sempre) e a fila de push (só quem tem inscrição ativa). Idempotente pela dedupe_key:
-- notices pelo id v5 e pelo índice único; notification_outbox por (user_id, dedupe_key). Devolve quantos push
-- entraram na fila.
create or replace function public.reminders_tick_save(p_user uuid, p_notices jsonb, p_outbox jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_enqueued int;
begin
  insert into public.notices (id, user_id, kind, dedupe_key, title, body, navigate)
  select (e.v->>'id')::uuid, p_user, e.v->>'kind', e.v->>'dedupeKey', e.v->>'title', e.v->>'body', e.v->>'navigate'
    from jsonb_array_elements(coalesce(p_notices, '[]'::jsonb)) as e(v)
  on conflict do nothing;

  insert into public.notification_outbox (user_id, kind, dedupe_key, payload, scheduled_for)
  select p_user, e.v->>'kind', e.v->>'dedupeKey', e.v->'payload', (e.v->>'scheduledFor')::timestamptz
    from jsonb_array_elements(coalesce(p_outbox, '[]'::jsonb)) as e(v)
  on conflict do nothing;
  get diagnostics v_enqueued = row_count;
  return v_enqueued;
end $$;

-- Pega os push devidos com `for update skip locked` (dois ticks simultâneos não pegam o mesmo item) e marca o
-- item como em tentativa: attempts + 1 e scheduled_for empurrado 10 min (se a função cair no meio, o próximo tick
-- tenta de novo).
create or replace function public.reminders_tick_claim(p_now timestamptz default now(), p_limit int default 100)
returns jsonb language sql security definer set search_path = '' as $$
  with due as (
    select o.id
      from public.notification_outbox o
     where o.status = 'pending' and o.scheduled_for <= p_now
     order by o.scheduled_for, o.id
     limit greatest(p_limit, 0)
       for update skip locked
  ), claimed as (
    update public.notification_outbox o
       set attempts = o.attempts + 1, scheduled_for = p_now + interval '10 minutes'
      from due
     where o.id = due.id
    returning o.id, o.user_id, o.kind, o.dedupe_key, o.payload, o.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'userId', c.user_id, 'kind', c.kind, 'dedupeKey', c.dedupe_key,
           'payload', c.payload, 'attempts', c.attempts) order by c.user_id, c.id), '[]'::jsonb)
    from claimed c;
$$;

-- Para o envio de um usuário: inscrições ativas, push já enviados no dia local (teto de 3, UX 6.7) e os dias locais
-- com lançamento manual (o daily_log adiado pelo silêncio só sai se o dia continuar sem lançamento, US-39).
create or replace function public.reminders_tick_context(p_user uuid, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)
                       order by s.created_at, s.id)
        from public.push_subscriptions s
       where s.user_id = p_user and s.disabled_at is null), '[]'::jsonb),
    'sentToday', (
      select count(*)::int
        from public.notification_outbox o
       where o.user_id = p_user and o.status = 'sent'
         and (o.sent_at at time zone p.timezone)::date = (p_now at time zone p.timezone)::date),
    'loggedOn', coalesce((
      select jsonb_agg(distinct (t.created_at at time zone p.timezone)::date)
        from public.transactions t
       where t.user_id = p_user and t.source = 'manual' and t.deleted_at is null
         and t.created_at > p_now - interval '3 days' and t.created_at <= p_now), '[]'::jsonb))
  from public.profiles p
  where p.user_id = p_user;
$$;

-- Resultado do envio: status de cada item da fila ('sent' | 'failed' | 'skipped', ou 'pending' para tentar de novo
-- no próximo tick) e de cada inscrição (tech §6.4.4: 404/410 desativa, 429/5xx soma falha, sucesso zera).
create or replace function public.reminders_tick_record(p_now timestamptz, p_outbox jsonb, p_subs jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_outbox o
     set status  = e.v->>'status',
         sent_at = case when e.v->>'status' = 'sent' then p_now else o.sent_at end,
         error   = e.v->>'error'
    from jsonb_array_elements(coalesce(p_outbox, '[]'::jsonb)) as e(v)
   where o.id = (e.v->>'id')::uuid;

  update public.push_subscriptions s
     set last_success_at = case when e.v->>'outcome' = 'sent' then p_now else s.last_success_at end,
         failure_count   = case when e.v->>'outcome' = 'sent' then 0
                                when e.v->>'outcome' = 'retry' then s.failure_count + 1
                                else s.failure_count end,
         last_failure_at = case when e.v->>'outcome' in ('gone', 'retry', 'error') then p_now
                                else s.last_failure_at end,
         disabled_at     = case when e.v->>'outcome' = 'gone' then coalesce(s.disabled_at, p_now)
                                else s.disabled_at end
    from jsonb_array_elements(coalesce(p_subs, '[]'::jsonb)) as e(v)
   where s.id = (e.v->>'id')::uuid;
end $$;

revoke all on function public.reminders_tick_start(), public.reminders_tick_finish(bigint, text, jsonb, text),
  public.reminders_tick_snapshot(timestamptz), public.reminders_tick_save(uuid, jsonb, jsonb),
  public.reminders_tick_claim(timestamptz, int), public.reminders_tick_context(uuid, timestamptz),
  public.reminders_tick_record(timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.reminders_tick_start(), public.reminders_tick_finish(bigint, text, jsonb, text),
  public.reminders_tick_snapshot(timestamptz), public.reminders_tick_save(uuid, jsonb, jsonb),
  public.reminders_tick_claim(timestamptz, int), public.reminders_tick_context(uuid, timestamptz),
  public.reminders_tick_record(timestamptz, jsonb, jsonb)
  to service_role;
