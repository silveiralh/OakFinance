-- Migração 05 — RLS (tech §3.6, [CONTRATO]). DDL da spec com os ajustes de D-009 (revokes equivalentes e complementos no fim).
-- Não editar depois do merge.
-- 20261105000005_rls.sql
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- Tabelas sincronizadas graváveis: select/insert/update do dono. Sem DELETE (soft delete).
do $$ declare t text; begin
  for t in select table_name from app.sync_tables where client_writable loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy own_select on public.%I for select to authenticated
                    using ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy own_insert on public.%I for insert to authenticated
                    with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy own_update on public.%I for update to authenticated
                    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)$p$, t);
    -- equivalente a "revoke delete e o privilégio de esvaziar a tabela" da spec (D-009)
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select, insert, update, references, trigger on public.%I to authenticated', t);
  end loop; end $$;

-- profiles: a linha nasce pelo trigger de cadastro. A policy de insert continua porque o sync_push usa
-- INSERT … ON CONFLICT DO UPDATE (o Postgres exige permissão de insert mesmo quando a linha já existe).
-- O check (user_id = id) + FK para auth.users impedem criar o perfil de outra pessoa.

-- Somente leitura para o cliente
do $$ declare t text; begin
  foreach t in array array['bank_connections','external_accounts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy own_select on public.%I for select to authenticated
                    using ((select auth.uid()) = user_id)$p$, t);
    -- equivalente ao revoke de escrita da spec, deixando só leitura (D-009)
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select, references, trigger on public.%I to authenticated', t);
  end loop; end $$;
-- external_item_id é visível ao dono: sozinho não dá acesso a nada (a apiKey fica só no servidor).

alter table public.push_subscriptions enable row level security;
create policy own_all on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table public.notification_outbox enable row level security;
create policy own_select on public.notification_outbox for select to authenticated
  using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.notification_outbox from authenticated;

-- Schema app: nenhum acesso direto do cliente (só via RPC security definer)
revoke all on all tables in schema app from authenticated, anon;
grant select on app.v_sync_rows, app.sync_tables to authenticated;   -- sync_push lê o registro (não sensível)

-- Complementos (D-009):
-- 1) RLS forçada também em push_subscriptions e notification_outbox (tech §8.3 item 1: todas as tabelas de public).
alter table public.push_subscriptions force row level security;
alter table public.notification_outbox force row level security;
-- 2) O revoke geral acima tira o execute de anon; o keepalive (tech §6.5) precisa do ping com a chave publicável.
grant execute on function public.ping() to anon;
