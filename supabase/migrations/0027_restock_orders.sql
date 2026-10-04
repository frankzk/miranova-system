-- Reposiciones pedidas al proveedor ("Ya lo pedí") y tiempo de reposición por producto.
-- Un pedido sigue "en camino" hasta que Drop registra una entrada de mercadería del producto
-- (STOCK_REQUEST, INITIAL_STOCK o MANUAL de entrada) después de pedirlo; eso se calcula al leer
-- (lib/inventory.ts → trackOrders), así que aquí no hace falta marcarlo a mano.

create table if not exists public.restock_orders (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  product_external_id text not null,
  units               integer not null check (units > 0),
  ordered_at          timestamptz not null default now(),
  eta                 date,            -- llegada estimada
  note                text,
  cancelled_at        timestamptz,
  created_by          uuid references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists restock_orders_product_idx on public.restock_orders (account_id, product_external_id, ordered_at desc);

alter table public.restock_orders enable row level security;

-- Días que tarda en llegar una reposición, fijados a mano (si no, se mide con los pedidos que ya
-- llegaron, o se usa el estándar).
create table if not exists public.product_lead_times (
  account_id          uuid not null references public.accounts(id) on delete cascade,
  product_external_id text not null,
  lead_days           integer not null check (lead_days between 1 and 180),
  updated_by          uuid references public.app_users(id) on delete set null,
  updated_at          timestamptz not null default now(),
  primary key (account_id, product_external_id)
);

alter table public.product_lead_times enable row level security;
