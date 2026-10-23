-- Compras › Laboratorios: compras locales a laboratorios (en quetzales) y cómo se reparten las
-- unidades entre las cuentas. Conviven con las importaciones en la sección Compras.
--   status: requested (solicitado) · in_progress (en proceso) · transit (en tránsito) · arrived (llegó a bodega)
--   distribution: unidades por cuenta destino, p. ej. {"miranova_gt": 500, "mireva_hn": 200}
--   monto en quetzales = unit_price_gtq × qty_requested (la cortesía no se cobra); en USD, ÷ fx_gtq_per_usd

set lock_timeout = '5s';

create table if not exists public.lab_purchases (
  id             uuid primary key default gen_random_uuid(),
  product        text not null,
  lab_name       text,
  status         text not null default 'requested' check (status in ('requested', 'in_progress', 'transit', 'arrived')),
  requested_at   date not null default ((now() at time zone 'America/Tegucigalpa')::date),
  shipped_at     date,
  arrived_at     date,
  boxes          integer check (boxes is null or boxes >= 0),
  qty_requested  integer not null check (qty_requested > 0),
  qty_courtesy   integer not null default 0 check (qty_courtesy >= 0),
  distribution   jsonb not null default '{}'::jsonb,
  unit_price_gtq numeric(14, 4) check (unit_price_gtq is null or unit_price_gtq >= 0),
  fx_gtq_per_usd numeric(10, 4) check (fx_gtq_per_usd is null or fx_gtq_per_usd > 0),
  notes          text,
  created_by     uuid references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists lab_purchases_requested_idx on public.lab_purchases (requested_at desc, created_at desc);
alter table public.lab_purchases enable row level security;
