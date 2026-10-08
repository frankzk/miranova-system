-- Ajustes del panel que el dueño cambia desde Ajustes (sin tocar Vercel).
--   key "email": { gmail_user, gmail_app_password (cifrada con ENCRYPTION_KEY, lib/crypto.ts),
--                  digest_to: [correos que reciben el resumen diario de inventario] }

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_by  uuid references public.app_users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

alter table public.app_settings enable row level security;
