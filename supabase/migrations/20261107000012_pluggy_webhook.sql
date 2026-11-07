-- Migração 12 — idempotência do `pluggy-webhook` em app.integration_events (tech §6.1.4; T-075). Aditiva.
-- Só a Edge Function, com a chave secreta (service_role), registra e fecha os eventos.

-- Registra o evento; devolve false se o `event_id` já tinha chegado (a Pluggy repete até 3 vezes).
create or replace function public.pluggy_webhook_record(
  p_event_id text, p_event text, p_item_id text, p_user uuid, p_payload jsonb
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  insert into app.integration_events (event_id, provider, event, item_id, user_id, payload)
  values (p_event_id, 'pluggy', p_event, p_item_id, p_user, coalesce(p_payload, '{}'::jsonb))
  on conflict (event_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count = 1;
end $$;

create or replace function public.pluggy_webhook_done(p_event_id text, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update app.integration_events
     set processed_at = now(), error = left(p_error, 200)
   where event_id = p_event_id;
$$;

revoke all on function public.pluggy_webhook_record(text, text, text, uuid, jsonb),
  public.pluggy_webhook_done(text, text) from public, anon, authenticated;
grant execute on function public.pluggy_webhook_record(text, text, text, uuid, jsonb),
  public.pluggy_webhook_done(text, text) to service_role;
