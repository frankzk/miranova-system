-- Importaciones (fase 1). Cada importación va a un país, con sus productos (del catálogo o
-- nuevos con foto), costos en USD que se reparten para sacar el costo final por unidad, pagos,
-- documentos (bucket privado import-files), transporte y estados con historial.

create table if not exists public.imports (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,                 -- IMP-2026-001
  supplier        text,
  origin          text,                                 -- país o ciudad de origen
  dest_country    text not null,                        -- GT, CR…
  status          text not null default 'quote',
  ordered_at      date,
  eta             date,                                 -- llegada estimada
  arrived_at      date,
  transport       text not null default 'courier',
  carrier         text,                                 -- DHL, FedEx…
  tracking_number text,
  tracking_url    text,                                 -- si la paquetera no es de las conocidas
  weight_kg       numeric check (weight_kg >= 0),
  reported_at     timestamptz,                          -- avisado a la bodega (Boxful)
  reported_by     uuid references public.app_users(id) on delete set null,
  notes           text,
  created_by      uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists imports_status_idx on public.imports (status, created_at desc);

create table if not exists public.import_items (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid not null references public.imports(id) on delete cascade,
  account_id          uuid references public.accounts(id) on delete set null,  -- producto del catálogo
  product_external_id text,
  name                text not null,
  sku                 text,
  image_url           text,             -- foto del catálogo
  photo_path          text,             -- foto subida (producto nuevo), en import-files
  qty                 integer not null check (qty > 0),
  unit_cost           numeric not null default 0 check (unit_cost >= 0),       -- USD
  unit_weight_kg      numeric check (unit_weight_kg >= 0),
  sale_price_usd      numeric check (sale_price_usd >= 0),  -- precio de venta esperado (si no se toma de Drop)
  position            integer not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists import_items_import_idx on public.import_items (import_id, position);

create table if not exists public.import_costs (
  id         uuid primary key default gen_random_uuid(),
  import_id  uuid not null references public.imports(id) on delete cascade,
  kind       text not null check (kind in ('shipping', 'import', 'other')),
  label      text not null,
  amount     numeric not null check (amount >= 0),                          -- USD
  allocation text not null default 'value' check (allocation in ('value', 'units', 'weight', 'item')),
  item_id    uuid references public.import_items(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists import_costs_import_idx on public.import_costs (import_id);

create table if not exists public.import_documents (
  id           uuid primary key default gen_random_uuid(),
  import_id    uuid not null references public.imports(id) on delete cascade,
  kind         text not null check (kind in ('invoice', 'payment', 'tracking', 'packing', 'customs', 'photo', 'other')),
  storage_path text not null unique,
  filename     text,
  content_type text not null,
  size_bytes   integer,
  uploaded_by  uuid references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists import_documents_import_idx on public.import_documents (import_id);

create table if not exists public.import_payments (
  id          uuid primary key default gen_random_uuid(),
  import_id   uuid not null references public.imports(id) on delete cascade,
  paid_at     date not null,
  amount      numeric not null check (amount > 0),                          -- USD
  method      text not null,
  note        text,
  document_id uuid references public.import_documents(id) on delete set null,  -- comprobante
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists import_payments_import_idx on public.import_payments (import_id);

create table if not exists public.import_events (
  id        uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.imports(id) on delete cascade,
  status    text,                 -- estado nuevo; null para otros hechos (reportado, nota)
  note      text,
  by_user   uuid references public.app_users(id) on delete set null,
  at        timestamptz not null default now()
);
create index if not exists import_events_import_idx on public.import_events (import_id, at desc);

-- Solo el backend (service role) accede.
alter table public.imports          enable row level security;
alter table public.import_items     enable row level security;
alter table public.import_costs     enable row level security;
alter table public.import_documents enable row level security;
alter table public.import_payments  enable row level security;
alter table public.import_events    enable row level security;

-- Archivos privados: facturas, comprobantes, guías y fotos de productos nuevos. Se leen por
-- /api/imports/doc/[id] y /api/imports/item/[id], que revisan el permiso y redirigen a un enlace
-- firmado de pocos minutos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('import-files', 'import-files', false, 26214400, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do nothing;
