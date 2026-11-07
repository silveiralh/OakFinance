-- pluggy_webhook_record/done (T-075, tech §6.1.4): idempotência por event_id e só service_role.
begin;
select plan(6);

select ok(not has_function_privilege('authenticated',
  'public.pluggy_webhook_record(text, text, text, uuid, jsonb)', 'execute'), 'authenticated não registra eventos');
select ok(not has_function_privilege('anon', 'public.pluggy_webhook_done(text, text)', 'execute'),
  'anon não fecha eventos');
select ok(public.pluggy_webhook_record('evt-1', 'item/updated', 'item-1', null, '{"event":"item/updated"}'::jsonb),
  'evento novo é registrado');
select ok(not public.pluggy_webhook_record('evt-1', 'item/updated', 'item-1', null, '{}'::jsonb),
  'o mesmo event_id não é registrado de novo');
select public.pluggy_webhook_done('evt-1');
select ok((select processed_at is not null and error is null from app.integration_events where event_id = 'evt-1'),
  'fecha o evento sem erro');
select public.pluggy_webhook_done('evt-1', 'UPSTREAM_UNAVAILABLE');
select is((select error from app.integration_events where event_id = 'evt-1'), 'UPSTREAM_UNAVAILABLE',
  'guarda só o código do erro');

select * from finish();
rollback;
