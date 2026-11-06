-- Productos nuevos de las solicitudes: lo que pide un cliente (sobre todo uno potencial, p. ej. una
-- maquila) y todavía no existe en Drop. Se crean desde "Nueva solicitud" con su nombre y, si hay, una
-- foto; más adelante se vinculan con el producto de Drop cuando exista.
--   name_key:   el nombre normalizado (minúsculas, sin tildes ni espacios de más): uno por nombre, y
--               así cada línea de una solicitud con ese nombre es ese producto.
--   photo_path: foto en el bucket privado request-files (se ve por /api/requests/products/[id]/photo).
--   account_id + product_external_id: el producto de Drop con el que se vinculó (null = sin vincular).

set lock_timeout = '5s';

create table if not exists public.request_products (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(btrim(name)) between 1 and 160),
  name_key            text not null check (length(name_key) between 1 and 160),
  photo_path          text,
  account_id          uuid references public.accounts(id) on delete set null,
  product_external_id text,
  linked_at           timestamptz,
  created_by          uuid references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists request_products_name_key_idx on public.request_products (name_key);
alter table public.request_products enable row level security;

-- fotos de los productos nuevos: privadas, solo imágenes y hasta 10 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('request-files', 'request-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
