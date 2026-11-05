-- Migração 01 — base (tech §3.2, [CONTRATO]). DDL literal da spec. Não editar depois do merge.
-- 20261105000001_base.sql
create schema if not exists app;                       -- interno (não exposto pelo PostgREST)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;
-- supabase_vault já vem instalado no Supabase

create sequence if not exists app.sync_version_seq as bigint;

grant usage on schema app to authenticated, service_role;

-- Configuração do sync (linha única)
create table app.sync_config (
  id boolean primary key default true check (id),
  purge_horizon_version bigint not null default 0,   -- clientes com cursor menor precisam de reset
  tombstone_retention interval not null default interval '90 days'
);
insert into app.sync_config default values;

-- Registro das tabelas sincronizadas
create table app.sync_tables (
  table_name      text primary key,
  client_writable boolean not null,                  -- aceita escrita via sync_push
  push_order      int not null                       -- pais antes de filhos (FKs)
);
