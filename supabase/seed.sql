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
  ('e2e-close-desktop@example.test')
on conflict do nothing;
