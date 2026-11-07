-- Seed do ambiente local e do CI (tech §2.1). Roda em `supabase db reset`.
-- Repositório público: só e-mails @example.test, nunca e-mails reais.
-- Allowlist de teste para o cadastro fechado (hook before_user_created, ADR-17).
insert into app.allowed_emails (email) values
  ('e2e-a@example.test'),
  ('e2e-b@example.test'),
  -- onboarding (E01 completo, T-065): um usuário novo por projeto do Playwright, para os 3 não dividirem o progresso
  ('e2e-onb-android@example.test'),
  ('e2e-onb-iphone@example.test'),
  ('e2e-onb-desktop@example.test'),
  -- conferência de importados (I05, T-079): um usuário por projeto, para os contadores não se misturarem
  ('e2e-inbox-android@example.test'),
  ('e2e-inbox-iphone@example.test'),
  ('e2e-inbox-desktop@example.test'),
  -- fechar o mês (P04, T-082): idem
  ('e2e-close-android@example.test'),
  ('e2e-close-iphone@example.test'),
  ('e2e-close-desktop@example.test'),
  -- importar OFX (I03, T-084): idem (o mesmo arquivo nos 3 navegadores daria "já foi importado")
  ('e2e-import-android@example.test'),
  ('e2e-import-iphone@example.test'),
  ('e2e-import-desktop@example.test'),
  -- CSV (E08, T-086): separado do E07, que roda em paralelo e sobrescrevia o perfil CSV salvo na conta
  ('e2e-csv-android@example.test'),
  ('e2e-csv-iphone@example.test'),
  ('e2e-csv-desktop@example.test'),
  -- painel sem renda (E17, T-095): usuário que nunca recebe renda
  ('e2e-dash-android@example.test'),
  ('e2e-dash-iphone@example.test'),
  ('e2e-dash-desktop@example.test'),
  -- NFC-e (E09, T-089): notas pendentes de um usuário próprio não são relidas nos outros cenários do e2e-a
  ('e2e-nfce-android@example.test'),
  ('e2e-nfce-iphone@example.test'),
  ('e2e-nfce-desktop@example.test')
on conflict do nothing;
