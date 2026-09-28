-- Fotos y videos reales de los productos, internos para el equipo (no se publican en ninguna
-- plataforma). Los archivos van en un bucket privado de Supabase Storage; el panel los entrega
-- con enlaces firmados de pocos minutos y solo a usuarios con permiso de Productos.
-- Se agrupan por SKU (media_key = "sku:<SKU>"), así las fotos de un producto aparecen en todos
-- los países donde se vende; sin SKU, por producto de la cuenta ("id:<cuenta>:<id externo>").
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-media', 'product-media', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  media_key text not null,
  storage_path text not null unique,
  kind text not null check (kind in ('photo', 'video')),
  content_type text not null,
  size_bytes bigint,
  filename text,
  caption text,
  uploaded_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists product_media_key_idx on public.product_media (media_key, created_at);

alter table public.product_media enable row level security;
revoke all on public.product_media from anon, authenticated;
