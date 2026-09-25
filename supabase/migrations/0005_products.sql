-- Catálogo de productos del proveedor en cada plataforma.

create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  external_id   text not null,          -- id interno de la plataforma
  code          text,                   -- código visible, ej. ID-Z1GIC
  name          text not null,
  sku           text,
  status        text,                   -- Activo, Inactivo, ...
  price         numeric(12,2),          -- precio del proveedor
  suggested_price numeric(12,2),        -- precio sugerido de venta (si existe)
  stock         integer,                -- inventario total
  image_url     text,
  currency      text,
  created_at_platform timestamptz,
  raw           jsonb not null,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (account_id, external_id)
);

create index if not exists products_account_idx on public.products (account_id);
create index if not exists products_sku_idx on public.products (sku);

alter table public.products enable row level security;

alter table public.accounts
  add column if not exists products_path   text,
  add column if not exists products_sync_at timestamptz,
  add column if not exists products_sync_msg text;

-- Unidades y órdenes por SKU en un período (para "vendido 30 días" en Productos).
create or replace function public.product_sales(p_account uuid, p_from timestamptz)
returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('units', units, 'orders', orders)), '{}'::jsonb) from (
    select coalesce(nullif(i.sku, ''), i.product_name) as k, sum(i.quantity) as units, count(distinct o.id) as orders
    from public.orders o join public.order_items i on i.order_id = o.id
    where (p_account is null or o.account_id = p_account)
      and o.ordered_at >= p_from
      and public.status_group(o.status_code) is distinct from 'cancelled'
    group by 1
  ) s
$$;

revoke all on function public.product_sales(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.product_sales(uuid, timestamptz) to service_role;
