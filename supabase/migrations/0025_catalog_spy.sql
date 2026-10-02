-- Catálogo de la competencia: productos de otros proveedores vistos desde una
-- cuenta de dropshipper. Se guarda APARTE de `products` (que es el catálogo propio
-- del proveedor) para no mezclar ni afectar órdenes/inventario existentes.

-- Una cuenta marcada `catalog_only` solo baja este catálogo (no órdenes).
alter table public.accounts
  add column if not exists catalog_only     boolean not null default false,
  add column if not exists catalog_path      text,
  add column if not exists catalog_sync_at   timestamptz,
  add column if not exists catalog_sync_msg  text;

create table if not exists public.catalog_products (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  external_id   text not null,            -- id interno de la plataforma
  code          text,                     -- código visible (ID-XXXX)
  name          text not null,
  vendor        text,                     -- proveedor que ofrece el producto
  cost          numeric(12,2),            -- precio proveedor (lo que cuesta surtirlo)
  suggested     numeric(12,2),            -- precio sugerido de venta
  stock         integer,
  image_url     text,
  currency      text,
  raw           jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account_id, external_id)
);

create index if not exists catalog_products_account_idx on public.catalog_products (account_id);
create index if not exists catalog_products_vendor_idx  on public.catalog_products (vendor);
create index if not exists catalog_products_name_idx    on public.catalog_products (name);

-- RLS activado sin políticas: solo la service_role (servidor) accede, igual que products.
alter table public.catalog_products enable row level security;
