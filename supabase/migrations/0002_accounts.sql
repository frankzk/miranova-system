-- Varias cuentas: una por plataforma + país (Drop Honduras, Drop Guatemala, Dropi Colombia, ...)
-- Un mismo correo de Drop puede tener varias cuentas; cada una se guarda por separado
-- con su `platform_ref` (la cuenta elegida al iniciar sesión).

create table if not exists public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,                    -- "Drop Honduras"
  platform           text not null check (platform in ('soydrop', 'dropi')),
  country            text not null,                    -- ISO: HN, GT, SV, CR, CO, ...
  currency           text not null,                    -- HNL, GTQ, USD, ...
  timezone           text not null default 'America/Tegucigalpa',
  login_email        text not null,
  password_enc       text not null,                    -- AES-256-GCM, llave solo en Vercel
  platform_ref       text,                             -- cuenta elegida dentro del login
  platform_ref_name  text,
  session_enc        text,                             -- sesión cifrada (se reutiliza)
  orders_path        text,                             -- ruta de la API de órdenes descubierta
  enabled            boolean not null default true,
  last_sync_at       timestamptz,
  last_sync_ok       boolean,
  last_sync_msg      text,
  debug              jsonb,                            -- diagnóstico del último intento
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.accounts enable row level security;

alter table public.orders     add column if not exists account_id uuid references public.accounts(id) on delete cascade;
alter table public.ingest_log add column if not exists account_id uuid references public.accounts(id) on delete set null;

-- el número de orden es único por cuenta, no global
alter table public.orders drop constraint if exists orders_external_id_key;
create unique index if not exists orders_account_external_idx on public.orders (account_id, external_id);
create index if not exists orders_account_idx on public.orders (account_id);
