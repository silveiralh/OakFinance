-- Migração 06 — Auth: perfil e cadastro fechado (tech §3.7, [CONTRATO]). DDL literal da spec.
-- Não editar depois do merge.
-- 20261105000006_auth.sql
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, user_id, display_name)
  values (new.id, new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Auth Hook "Before User Created" (ativar no Dashboard → Authentication → Hooks; ver seção 9).
-- Confirmar o formato de retorno na documentação de Auth Hooks no momento da implementação.
create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(event->'user'->>'email');
begin
  if exists (select 1 from app.allowed_emails where email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Este app é de uso privado.'));
end $$;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema app to supabase_auth_admin;
grant select on app.allowed_emails to supabase_auth_admin;
-- Os e-mails reais NÃO entram no repositório: o cliente insere via SQL Editor (seção 9).
