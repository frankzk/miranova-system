-- Compras › Traslados: envíos entre bodegas de varios productos juntos (p. ej. de Boxful Guatemala a Honduras),
-- con su manifiesto, fechas, y lo que llegó a cada bodega de destino (recibidas, dañadas y la merma).
--   transfer_points: bodegas de origen y de destino. `goods`: qué recibe como destino (importados, maquilados o
--     los dos); `accounts`: las cuentas de los repartos de Laboratorios que abastece (miranova_hn…).
--   transfers: un traslado sale de un punto hacia un país; cada producto va a una bodega de ese país.
--   transfer_items.source: de qué reparto sale ("req:<solicitud>:<producto>:<país>" o "lab:<compra>:<cuenta>"),
--     para descontarlo de "Por enviar".
--   transfer_arrivals: llegada a cada bodega de destino (fecha y quién la registró).
--   transfer_settled: repartos que se dan por enviados sin traslado (ya no salen en "Por enviar").

set lock_timeout = '5s';

create table if not exists public.transfer_points (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[a-z0-9_]{2,40}$'),
  name           text not null check (length(btrim(name)) between 1 and 80),
  country        text not null check (country ~ '^[A-Z]{2}$'),
  city           text,
  goods          text not null default 'both' check (goods in ('import', 'maquila', 'both')),
  is_origin      boolean not null default false,
  is_destination boolean not null default true,
  accounts       text[] not null default '{}',
  active         boolean not null default true,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.transfers (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,                                -- TR-2026-001
  origin_id    uuid not null references public.transfer_points(id),
  dest_country text not null check (dest_country ~ '^[A-Z]{2}$'),
  carrier      text,                                                -- Boxful, Moi…
  reference    text,                                                -- n.º de manifiesto o guía
  status       text not null default 'preparing' check (status in ('preparing', 'transit', 'arrived', 'cancelled')),
  shipped_at   date,
  eta          date,
  notes        text,
  created_by   uuid references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists transfers_status_idx on public.transfers (status, created_at desc);

create table if not exists public.transfer_items (
  id                  uuid primary key default gen_random_uuid(),
  transfer_id         uuid not null references public.transfers(id) on delete cascade,
  dest_id             uuid not null references public.transfer_points(id),
  kind                text not null default 'import' check (kind in ('import', 'maquila')),
  name                text not null check (length(btrim(name)) between 1 and 200),
  sku                 text,
  account_id          uuid references public.accounts(id) on delete set null,   -- producto del catálogo de Drop
  product_external_id text,
  image_url           text,
  qty                 integer not null check (qty > 0),
  source              text,
  received_qty        integer check (received_qty >= 0),                          -- null: todavía no llega
  damaged_qty         integer not null default 0 check (damaged_qty >= 0),
  received_note       text,
  position            integer not null default 0,
  created_at          timestamptz not null default now(),
  check (received_qty is null or damaged_qty <= received_qty)
);
create index if not exists transfer_items_transfer_idx on public.transfer_items (transfer_id, position);
create index if not exists transfer_items_source_idx on public.transfer_items (source) where source is not null;

create table if not exists public.transfer_arrivals (
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  dest_id     uuid not null references public.transfer_points(id),
  arrived_at  date not null,
  note        text,
  received_by uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (transfer_id, dest_id)
);

create table if not exists public.transfer_documents (
  id           uuid primary key default gen_random_uuid(),
  transfer_id  uuid not null references public.transfers(id) on delete cascade,
  kind         text not null default 'manifest' check (kind in ('manifest', 'photo', 'other')),
  storage_path text not null unique,
  filename     text,
  content_type text not null,
  size_bytes   integer,
  uploaded_by  uuid references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists transfer_documents_transfer_idx on public.transfer_documents (transfer_id);

create table if not exists public.transfer_events (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  note        text not null,
  by_user     uuid references public.app_users(id) on delete set null,
  at          timestamptz not null default now()
);
create index if not exists transfer_events_transfer_idx on public.transfer_events (transfer_id, at desc);

create table if not exists public.transfer_settled (
  source  text primary key,
  note    text,
  by_user uuid references public.app_users(id) on delete set null,
  at      timestamptz not null default now()
);

-- Solo el backend (service role) accede.
alter table public.transfer_points    enable row level security;
alter table public.transfers          enable row level security;
alter table public.transfer_items     enable row level security;
alter table public.transfer_arrivals  enable row level security;
alter table public.transfer_documents enable row level security;
alter table public.transfer_events    enable row level security;
alter table public.transfer_settled   enable row level security;

-- Bodegas de hoy (se editan en Compras › Traslados › Bodegas).
insert into public.transfer_points (code, name, country, city, goods, is_origin, is_destination, accounts, position) values
  ('boxful_gt',    'Boxful Guatemala',          'GT', 'Ciudad de Guatemala', 'both',    true,  true,  '{miranova_gt}', 10),
  ('moi_gt',       'Bodega de Moi',             'GT', null,                  'maquila', true,  true,  '{dropi_gt}', 20),
  ('mireva_tgu',   'Mireva · Tegucigalpa',      'HN', 'Tegucigalpa',         'both',    false, true,  '{mireva_hn}', 30),
  ('miranova_sps', 'Miranova · San Pedro Sula', 'HN', 'San Pedro Sula',      'both',    false, true,  '{miranova_hn}', 40),
  ('alex_sv',      'Bodega de Alex',            'SV', null,                  'maquila', false, true,  '{miranova_sv}', 50),
  ('boxful_sv',    'Boxful El Salvador',        'SV', null,                  'import',  false, true,  '{}', 60),
  ('bodega_cr',    'Bodega Costa Rica',         'CR', null,                  'both',    true,  true,  '{miranova_cr,mireva_cr,dropi_cr}', 70)
on conflict (code) do nothing;

-- Manifiestos, fotos de llegada y otros documentos: privados, se leen por /api/transfers/doc/[id].
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transfer-files', 'transfer-files', false, 26214400, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do nothing;
