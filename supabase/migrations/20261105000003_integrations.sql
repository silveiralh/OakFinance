-- Migração 03 — integrações e push (tech §3.4, [CONTRATO]). DDL literal da spec. Não editar depois do merge.
-- 20261105000003_integrations.sql
create table public.bank_connections (           -- escrita SÓ por Edge Function (service role)
  id                 uuid primary key,
  user_id            uuid not null references auth.users(id) on delete cascade,
  provider           text not null default 'pluggy' check (provider in ('pluggy')),
  external_item_id   text not null unique,        -- um item Pluggy pertence a um único usuário
  connector_id       int,
  connector_name     text,                        -- ex.: 'MeuPluggy' / nome do banco
  institution        text,                        -- 'bb' | 'nubank' | …
  status             text not null,               -- status Pluggy: UPDATED|UPDATING|OUTDATED|LOGIN_ERROR|WAITING_USER_INPUT
  execution_status   text,
  consent_expires_at timestamptz,
  last_synced_at     timestamptz,                 -- última execução nossa
  last_success_at    timestamptz,
  provider_updated_at timestamptz,                -- item.lastUpdatedAt (Pluggy)
  last_error         text,
  is_active          boolean not null default true,
  last_manual_refresh_at timestamptz,             -- limite de PATCH /items (1 por hora)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id)
);

create table public.external_accounts (          -- contas do provedor; o mapeamento é feito pelo usuário via RPC
  id                  uuid primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  connection_id       uuid not null,
  external_account_id text not null unique,
  type                text not null,              -- BANK | CREDIT
  subtype             text not null,              -- CHECKING_ACCOUNT | SAVINGS_ACCOUNT | CREDIT_CARD
  name                text,
  number_masked       text,
  account_id          uuid,                       -- mapeamento local (um dos dois, ou nenhum)
  card_id             uuid,
  is_ignored          boolean not null default false,
  balance_cents       bigint,                     -- com sinal, como informado
  credit_limit_cents  bigint,
  available_limit_cents bigint,
  balance_close_date  date,
  balance_due_date    date,
  last_tx_date        date,                       -- maior data importada (para a janela incremental)
  backfill_done_at    timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(), deleted_at timestamptz,
  server_version bigint not null default 0, device_id text,
  unique (user_id, id),
  check (num_nonnulls(account_id, card_id) <= 1),
  foreign key (user_id, connection_id) references public.bank_connections (user_id, id),
  foreign key (user_id, account_id) references public.accounts (user_id, id),
  foreign key (user_id, card_id) references public.cards (user_id, id)
);

create table app.integration_events (           -- webhooks recebidos (idempotência + auditoria)
  event_id     text primary key,                -- Pluggy eventId
  provider     text not null default 'pluggy',
  event        text not null,
  item_id      text,
  user_id      uuid references auth.users(id) on delete cascade,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

create table public.push_subscriptions (        -- gerida por RPC, não sincronizada
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  platform        text not null check (platform in ('android','ios','desktop','other')),
  user_agent      text,
  device_id       text,
  created_at      timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  failure_count   int not null default 0,
  disabled_at     timestamptz
);
create index push_subs_user_idx on public.push_subscriptions (user_id) where disabled_at is null;

create table public.notification_outbox (       -- gerada e consumida pelo reminders-tick
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null,
  dedupe_key    text not null,                  -- ex.: 'invoice_due:<invoice_id>:d3'
  payload       jsonb not null,                 -- DeclarativePushPayload (6.4.3)
  scheduled_for timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts      int not null default 0,
  sent_at       timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notif_pending_idx on public.notification_outbox (scheduled_for) where status = 'pending';
