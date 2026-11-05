-- Migração 02 — núcleo (tech §3.3, [CONTRATO]). DDL literal da spec. Não editar depois do merge.
-- 20261105000002_core.sql
-- Macro mental: toda tabela abaixo termina com o bloco "AUDIT" que se repete literalmente:
--   created_at timestamptz not null default now(),
--   updated_at timestamptz not null default now(),
--   client_updated_at timestamptz not null default now(),
--   deleted_at timestamptz,
--   server_version bigint not null default 0,
--   device_id text,
--   unique (user_id, id)

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade check (user_id = id),
  display_name  text,
  timezone      text not null default 'America/Sao_Paulo',
  -- preferências versionadas junto com o perfil (ver tipo ProfileSettings em 5.10)
  settings      jsonb not null default '{}'::jsonb,
  onboarding    jsonb not null default '{}'::jsonb,   -- passos concluídos (instalação, push, seeds)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id)
);

create table public.accounts (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  type          text not null check (type in ('checking','savings','cash','meal_voucher','food_voucher','investment','other')),
  institution   text,                                  -- 'bb' | 'nubank' | texto livre
  initial_balance_cents bigint not null default 0,     -- único campo monetário que pode ser negativo (cheque especial)
  initial_balance_on    date not null default current_date,
  is_restricted boolean not null default false,        -- VR/VA: saldo carimbado
  include_in_spendable boolean not null default true,
  color text, icon text,
  sort_order    int not null default 0,
  archived_at   timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id)
);

create table public.cards (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  institution   text,
  brand         text,
  last4         text check (last4 ~ '^\d{4}$'),        -- nunca o número completo
  limit_cents   bigint check (limit_cents >= 0),
  closing_day   smallint not null check (closing_day between 1 and 31),
  due_day       smallint not null check (due_day between 1 and 31),
  closing_day_rule text not null default 'next' check (closing_day_rule in ('next','same')), -- compra NO dia do fechamento: próxima fatura (padrão) ou a que fecha (RN-09)
  payment_account_id uuid,                             -- conta que paga a fatura (padrão)
  color text, icon text,
  sort_order    int not null default 0,
  archived_at   timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  foreign key (user_id, payment_account_id) references public.accounts (user_id, id)
);

-- id = uuidv5(NS_INVOICE, card_id || ':' || 'YYYY-MM' do vencimento)  (ver ids.ts)
create table public.invoices (
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id          uuid not null,
  reference_month  date not null check (extract(day from reference_month) = 1),  -- mês do VENCIMENTO
  closing_date     date not null,
  due_date         date not null,
  is_manual_dates  boolean not null default false,     -- usuário ajustou fechamento ou vencimento
  external_bill_id text,                               -- Pluggy bill.id
  external_total_cents       bigint,
  external_min_payment_cents bigint,
  notes            text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  check (closing_date < due_date),
  foreign key (user_id, card_id) references public.cards (user_id, id)
);
create unique index invoices_card_month_uq on public.invoices (user_id, card_id, reference_month) where deleted_at is null;

create table public.categories (
  id          uuid primary key,                        -- seeds: uuidv5(NS_CATEGORY, user_id || ':' || slug)
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  slug        text,                                    -- só nas padrão (ex.: 'mercado')
  parent_id   uuid,
  kind        text not null check (kind in ('expense','income','transfer')),
  bucket      text not null check (bucket in ('needs','wants','savings','income','transfer','none')),
  icon text, color text,
  is_default  boolean not null default false,
  is_system   boolean not null default false,          -- "A classificar", "Saldo credor": não editável nem excluível (RN-40)
  feeds_reserve boolean not null default false check (not feeds_reserve or bucket = 'savings'), -- RN-54
  name_ci     text generated always as (lower(name)) stored,
  sort_order  int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  foreign key (user_id, parent_id) references public.categories (user_id, id),
  check ((kind = 'income') = (bucket = 'income')),
  check ((kind = 'transfer') = (bucket = 'transfer'))
);
create unique index categories_slug_uq on public.categories (user_id, slug) where slug is not null and deleted_at is null;
-- parent_id existe para evolução, mas NÃO é usado no MVP (subcategorias são não-objetivo do PRD 1.3)

create table public.category_rules (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  match_field  text not null default 'description' check (match_field in ('description','merchant_cnpj')),
  match_type   text not null default 'token_prefix' check (match_type in ('token_prefix','contains','starts_with','equals','regex')), -- token_prefix = RN-59
  pattern      text not null check (char_length(pattern) between 2 and 80), -- já normalizado (normalizeDescription)
  category_id  uuid not null,
  account_id   uuid,                                   -- regra restrita a uma conta (RN-59/RN-60)
  card_id      uuid,                                   -- ou a um cartão
  payment_method text,                                 -- regra opcionalmente restrita a um meio
  source       text not null check (source in ('default','learned','manual')),
  priority     int not null default 0,
  hits         int not null default 0,
  last_hit_at  timestamptz,
  enabled      boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  check (num_nonnulls(account_id, card_id) <= 1),
  foreign key (user_id, category_id) references public.categories (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  foreign key (user_id, card_id) references public.cards (user_id, id)
);
create unique index category_rules_uq on public.category_rules (user_id, match_field, match_type, pattern,
  coalesce(account_id, card_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

-- Série de parcelas (a compra parcelada). As parcelas são linhas de transactions.
create table public.installment_plans (
  id                 uuid primary key,
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description        text not null check (char_length(description) between 1 and 120),
  card_id            uuid,                             -- parcelado no cartão (caso normal)
  account_id         uuid,                             -- carnê/boleto parcelado (sem fatura)
  purchase_date      date not null,
  first_due_on       date,                             -- só para account_id
  total_cents        bigint not null check (total_cents > 0),
  installments_count smallint not null check (installments_count between 2 and 48),
  first_installment_cents bigint check (first_installment_cents > 0), -- quando o banco arredonda diferente
  start_installment  smallint not null default 1 check (start_installment >= 1), -- compra já em andamento
  category_id        uuid,
  payment_method     text not null default 'credit',
  source             text not null default 'manual' check (source in ('manual','pluggy','ofx','csv')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  check (num_nonnulls(card_id, account_id) = 1),
  check (account_id is null or first_due_on is not null),
  check (start_installment <= installments_count),
  foreign key (user_id, card_id) references public.cards (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  foreign key (user_id, category_id) references public.categories (user_id, id) on delete set null (category_id)
);

create table public.recurrences (
  id               uuid primary key,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind             text not null check (kind in ('expense','income')),
  description      text not null check (char_length(description) between 1 and 120),
  amount_cents     bigint not null check (amount_cents > 0),
  is_variable_amount boolean not null default false,   -- valor estimado (ex.: conta de luz)
  category_id      uuid,
  account_id       uuid,
  card_id          uuid,
  payment_method   text not null check (payment_method in ('pix','debit','credit','cash','meal_voucher','food_voucher','transfer','boleto','auto_debit','other')),
  frequency        text not null check (frequency in ('monthly','weekly','yearly')),  -- a UI do MVP expõe só monthly/yearly (RN-26)
  match_pattern    text,                               -- termo de conciliação (RN-70), preenchido na 1ª conciliação manual
  interval_count   smallint not null default 1 check (interval_count between 1 and 12),
  day_of_month     smallint check (day_of_month between 1 and 31),
  weekday          smallint check (weekday between 0 and 6),     -- 0 = domingo
  month_of_year    smallint check (month_of_year between 1 and 12),
  start_on         date not null,
  end_on           date,
  max_occurrences  int check (max_occurrences > 0),
  is_fixed_income  boolean not null default false,     -- salário: entra no "Disponível para gastar" desde o 1º dia
  auto_post        boolean not null default false,     -- vira lançamento sozinho no dia; a UI liga por padrão quando card_id não é nulo (RN-26)
  remind           boolean not null default true,
  paused_at        timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  check (num_nonnulls(account_id, card_id) = 1),
  check (frequency <> 'monthly' or day_of_month is not null),
  check (frequency <> 'weekly'  or weekday is not null),
  check (frequency <> 'yearly'  or (day_of_month is not null and month_of_year is not null)),
  check (end_on is null or end_on >= start_on),
  check (not is_fixed_income or kind = 'income'),
  foreign key (user_id, account_id)  references public.accounts (user_id, id),
  foreign key (user_id, card_id)     references public.cards (user_id, id),
  foreign key (user_id, category_id) references public.categories (user_id, id) on delete set null (category_id)
);

create table public.budgets (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month         date check (month is null or extract(day from month) = 1),   -- null = padrão de todos os meses
  scope         text not null check (scope in ('bucket','category')),
  bucket        text check (bucket in ('needs','wants','savings')),
  category_id   uuid,
  pct_bp        int check (pct_bp between 0 and 10000),   -- basis points: 5000 = 50%
  limit_cents   bigint check (limit_cents >= 0),
  alert_thresholds_bp int[] not null default '{8000,10000}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  check (
    (scope = 'bucket'   and bucket is not null and category_id is null and pct_bp is not null)
 or (scope = 'category' and category_id is not null and bucket is null and limit_cents is not null)),
  foreign key (user_id, category_id) references public.categories (user_id, id)
);
create unique index budgets_uq on public.budgets
  (user_id, coalesce(month, date '1900-01-01'), scope, coalesce(bucket, ''),
   coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where deleted_at is null;

create table public.goals (
  id                   uuid primary key,              -- reserva: uuidv5(NS_GOAL, user_id || ':emergency')
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind                 text not null check (kind in ('emergency_reserve','custom')),
  name                 text not null,
  target_mode          text not null default 'auto' check (target_mode in ('auto','manual')),
  target_cents         bigint check (target_cents >= 0),        -- obrigatório quando manual
  auto_factor          smallint not null default 6 check (auto_factor between 1 and 24),
  auto_lookback_months smallint not null default 6 check (auto_lookback_months between 1 and 24),
  account_id           uuid,                          -- onde o dinheiro fica guardado (opcional)
  initial_saved_cents  bigint not null default 0 check (initial_saved_cents >= 0),
  achieved_at          timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  check (target_mode = 'auto' or target_cents is not null),
  foreign key (user_id, account_id) references public.accounts (user_id, id)
);
create unique index goals_one_reserve_uq on public.goals (user_id) where kind = 'emergency_reserve' and deleted_at is null;

create table public.imports (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source        text not null check (source in ('ofx','csv','nfce','pluggy')),
  file_name     text,
  file_sha256   text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  csv_profile   text,                                  -- id do CsvProfile usado
  account_id    uuid,
  card_id       uuid,
  status        text not null check (status in ('parsed','committed','failed','reverted')),
  period_start  date, period_end date,
  stats         jsonb not null default '{}'::jsonb,    -- {total,new,duplicates,autoMerged,suggested}
  error         text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  foreign key (user_id, card_id) references public.cards (user_id, id)
);
create unique index imports_file_uq on public.imports (user_id, file_sha256)
  where file_sha256 is not null and deleted_at is null and status <> 'reverted';

create table public.nfce_receipts (
  id             uuid primary key,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  access_key     char(44) not null check (access_key ~ '^\d{44}$'),
  qr_url         text not null,
  uf             char(2) not null,                     -- '41' = PR
  qr_version     smallint not null check (qr_version in (2,3)),
  issuer_cnpj    char(14) not null,
  issuer_name    text,
  issued_on      date,                                 -- data completa (página) ou 1º dia do AAMM (fallback)
  total_cents    bigint check (total_cents >= 0),
  discount_cents bigint check (discount_cents >= 0),
  items_count    int,
  parse_status   text not null check (parse_status in ('pending','full','fallback','failed')),
  parser_version text,
  fetched_at     timestamptz,
  error_code     text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id)
);
create unique index nfce_receipts_key_uq on public.nfce_receipts (user_id, access_key) where deleted_at is null;

create table public.transactions (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('expense','income','transfer','refund','adjust_in','adjust_out')),
  status          text not null default 'posted' check (status in ('posted','pending','cancelled')),
                  -- pending = autorizado, não compensado (Pluggy; conta como efetivado)
                  -- cancelled = "cancelada" do PRD: ocorrência pulada, receita "não recebi", parcelas restantes canceladas; fora de todo cálculo, visível no histórico
                  -- "prevista/agendada" NÃO é status: é derivada (ver 3.0)
  amount_cents    bigint not null check (amount_cents > 0),
  occurred_on     date not null,                       -- data da compra/recebimento (fuso do usuário)
  occurred_at     timestamptz,                         -- hora, quando conhecida
  description     text check (char_length(description) <= 200),
  description_raw text,                                -- como veio da fonte (importados)
  notes           text check (char_length(notes) <= 1000),
  category_id     uuid,
  category_source text not null default 'manual' check (category_source in ('manual','rule','provider','default','none')),
  category_rule_id uuid,
  payment_method  text not null check (payment_method in ('pix','debit','credit','cash','meal_voucher','food_voucher','transfer','boleto','auto_debit','other')),
  account_id      uuid,
  card_id         uuid,
  invoice_id      uuid,                                -- obrigatório se card_id; em pagamento de fatura aponta a fatura paga
  invoice_pinned  boolean not null default false,      -- "fatura_fixada": movido pelo usuário ou fatura informada pelo banco (RN-18/RN-19)
  counterpart_account_id uuid,                         -- transfer: conta de destino
  counterpart_card_id    uuid,                         -- transfer: pagamento de fatura deste cartão
  series_id       uuid,                                -- installment_plans.id
  installment_number smallint,
  installment_count  smallint,
  recurrence_id   uuid,
  recurrence_date date,                                -- data da ocorrência projetada que este lançamento realiza
  goal_id         uuid,                                -- aporte para a reserva/meta
  income_expected boolean not null default false,      -- receita variável que ainda não caiu ("A receber" ou "Prevista", RN-33)
  count_before_received boolean not null default false, -- "Contar antes de receber": true = Prevista (entra na Base), false = A receber
  source          text not null default 'manual' check (source in ('manual','pluggy','ofx','csv','nfce','recurrence','installment','system')), -- system = saldo credor (RN-15)
  external_id     text,                                -- Pluggy tx.id | OFX FITID normalizado | hash CSV
  external_meta   jsonb,                               -- ver 6.1.6 (billId, installment, provider category…)
  import_id       uuid,
  review_state    text not null default 'ok' check (review_state in ('ok','new','suggested','merged','ignored')),
  duplicate_of    uuid,                                -- importado conciliado → id do manual que o representa
  matched_external boolean not null default false,     -- manual já confirmado por uma fonte externa
  merchant_name   text,
  merchant_cnpj   char(14),
  nfce_receipt_id uuid,
  tags            text[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  check (num_nonnulls(account_id, card_id) = 1),
  check (card_id is null or invoice_id is not null),
  check (kind <> 'transfer' or num_nonnulls(counterpart_account_id, counterpart_card_id) = 1),
  check (kind = 'transfer' or num_nonnulls(counterpart_account_id, counterpart_card_id) = 0),
  check ((recurrence_id is null) = (recurrence_date is null)),
  check ((series_id is null) = (installment_number is null)),
  check (installment_number is null or installment_number between 1 and installment_count),
  check (not income_expected or kind = 'income'),
  check (not count_before_received or income_expected),
  check (duplicate_of is null or review_state = 'merged'),
  foreign key (user_id, account_id)  references public.accounts (user_id, id),
  foreign key (user_id, card_id)     references public.cards (user_id, id),
  foreign key (user_id, invoice_id)  references public.invoices (user_id, id),
  foreign key (user_id, counterpart_account_id) references public.accounts (user_id, id),
  foreign key (user_id, counterpart_card_id)    references public.cards (user_id, id),
  foreign key (user_id, category_id) references public.categories (user_id, id) on delete set null (category_id),
  foreign key (user_id, category_rule_id) references public.category_rules (user_id, id) on delete set null (category_rule_id),
  foreign key (user_id, series_id)   references public.installment_plans (user_id, id),
  foreign key (user_id, recurrence_id) references public.recurrences (user_id, id),
  foreign key (user_id, goal_id)     references public.goals (user_id, id),
  foreign key (user_id, import_id)   references public.imports (user_id, id),
  foreign key (user_id, duplicate_of) references public.transactions (user_id, id),
  foreign key (user_id, nfce_receipt_id) references public.nfce_receipts (user_id, id)
);
create index tx_user_date_idx     on public.transactions (user_id, occurred_on desc) where deleted_at is null;
create index tx_user_invoice_idx  on public.transactions (user_id, invoice_id) where invoice_id is not null and deleted_at is null;
create index tx_user_category_idx on public.transactions (user_id, category_id, occurred_on) where deleted_at is null;
create index tx_user_review_idx   on public.transactions (user_id, review_state) where review_state <> 'ok';
create unique index tx_external_uq    on public.transactions (user_id, source, external_id) where external_id is not null;
create unique index tx_recurrence_uq  on public.transactions (user_id, recurrence_id, recurrence_date) where recurrence_id is not null and deleted_at is null;
create unique index tx_installment_uq on public.transactions (user_id, series_id, installment_number) where series_id is not null and deleted_at is null;

create table public.receipt_items (
  id               uuid primary key,                   -- uuidv5(NS_RECEIPT_ITEM, receipt_id || ':' || line_no)
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  receipt_id       uuid not null,
  line_no          int not null check (line_no >= 1),
  code             text,
  description      text not null,
  quantity_milli   bigint not null check (quantity_milli > 0),    -- quantidade × 1000 (1,250 kg = 1250)
  unit             text,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  total_cents      bigint not null check (total_cents >= 0),
  category_id      uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  unique (user_id, receipt_id, line_no),
  foreign key (user_id, receipt_id) references public.nfce_receipts (user_id, id),
  foreign key (user_id, category_id) references public.categories (user_id, id) on delete set null (category_id)
);

create table public.reminders (
  id            uuid primary key,                      -- seeds: uuidv5(NS_REMINDER, user_id || ':' || kind)
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('invoice_due','invoice_closed','bill_due','bill_overdue','income_unconfirmed',
                                              'budget_threshold','daily_log','weekly_summary','bank_connection')),
  enabled       boolean not null default true,
  local_time    time not null default '09:00',         -- horário local de disparo
  weekday       smallint check (weekday between 0 and 6),           -- weekly_summary
  days_before   smallint[] not null default '{3,0}',   -- invoice_due {3,0} / bill_due {1} / bill_overdue e income_unconfirmed {-1} (D+1)
  skip_if_logged_today boolean not null default true,  -- daily_log
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id)
);
create unique index reminders_kind_uq on public.reminders (user_id, kind) where deleted_at is null;

-- Central de avisos (US-37). Gerada pelo reminders-tick (service role, para TODOS os usuários, com ou sem push)
-- e pelo aparelho (avisos locais, ex.: limite cruzado). O cliente só altera read_at e deleted_at.
create table public.notices (
  id            uuid primary key,                      -- uuidv5(NS_NOTICE, user_id || ':' || dedupe_key): idempotente
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind          text not null,                         -- mesmo vocabulário de reminders.kind
  dedupe_key    text not null,                         -- igual ao de notification_outbox
  title         text not null check (char_length(title) <= 60),
  body          text not null check (char_length(body) <= 160),  -- respeita hideValues no momento da criação
  navigate      text not null,                         -- rota do app (ex.: '/cartoes/<id>/fatura/2026-12')
  read_at       timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id)
);
create unique index notices_dedupe_uq on public.notices (user_id, dedupe_key) where deleted_at is null;

-- Mês fechado (US-36, RN-77)
create table public.month_closings (
  id            uuid primary key,                      -- uuidv5(NS_MONTH, user_id || ':' || 'YYYY-MM')
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month         date not null check (extract(day from month) = 1),
  closed_at     timestamptz,                           -- null = reaberto para revisão
  snapshot      jsonb not null default '{}'::jsonb,    -- totais (SpendableBreakdown + BucketStatus) no fechamento
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  unique (user_id, month)
);

-- Índices de cursor (um por tabela sincronizada)
do $$ declare t text; begin
  foreach t in array array['profiles','accounts','cards','invoices','categories','category_rules',
    'installment_plans','recurrences','budgets','goals','imports','nfce_receipts','transactions',
    'receipt_items','reminders','notices','month_closings'] loop
    execute format('create index %I on public.%I (user_id, server_version)', t || '_sync_idx', t);
  end loop; end $$;
