-- Migração 10 — rate limit das Edge Functions por usuário (tech §7.1, `app.rate_limits`; T-073). Aditiva.
-- `rate_limit_hit` conta uma chamada do usuário da sessão no balde e na janela atual e diz se ainda está dentro
-- do limite. Chamada pela função com o token do próprio usuário: ninguém conta chamadas de outra pessoa.
create or replace function public.rate_limit_hit(p_bucket text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_start timestamptz;
  v_count int;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_bucket is null or p_bucket !~ '^[a-z0-9-]{1,40}$' or p_limit is null or p_limit < 1
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  v_start := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds);
  insert into app.rate_limits as r (user_id, bucket, window_start, count)
  values (v_uid, p_bucket, v_start, 1)
  on conflict (user_id, bucket, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  return v_count <= p_limit;
end $$;

revoke all on function public.rate_limit_hit(text, int, int) from public, anon;
grant execute on function public.rate_limit_hit(text, int, int) to authenticated;
