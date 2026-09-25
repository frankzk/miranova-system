-- Miranova: pedidos recibidos desde Drop (app.soydrop.com)

create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  external_id      text not null unique,          -- "Orden de drop", ej. 1790369675744
  shopify_order    text,
  status           text,                          -- Pendiente, Despachado, ...
  dropshipper      text,
  customer_name    text,
  customer_email   text,
  customer_phone   text,
  department       text,
  city             text,
  address          text,
  reference_point  text,
  notes            text,                          -- "Indicaciones opcional"
  carrier          text,                          -- Paquetera (Forza, ...)
  tracking_number  text,
  total            numeric(12,2),
  currency         text default 'HNL',
  ordered_at       timestamptz,                   -- "Creación" en Drop
  raw              jsonb not null,                -- objeto original, para re-procesar
  first_seen_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists orders_ordered_at_idx on public.orders (ordered_at desc);
create index if not exists orders_status_idx on public.orders (status);
create index if not exists orders_dropshipper_idx on public.orders (dropshipper);

create table if not exists public.order_items (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders(id) on delete cascade,
  position     int not null default 0,
  sku          text,
  product_name text not null,
  quantity     int not null default 1,
  price        numeric(12,2),
  image_url    text
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- Respuestas crudas recibidas (útil para depurar el mapeo de campos)
create table if not exists public.ingest_log (
  id           bigint generated always as identity primary key,
  received_at  timestamptz not null default now(),
  source       text not null,                     -- 'extension' | 'cron'
  source_url   text,
  orders_found int not null default 0,
  payload      jsonb not null
);

create index if not exists ingest_log_received_idx on public.ingest_log (received_at desc);

-- Solo el backend (service role) accede. Sin políticas = sin acceso para anon/authenticated.
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.ingest_log  enable row level security;
