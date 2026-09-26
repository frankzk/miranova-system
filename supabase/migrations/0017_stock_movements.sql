-- Movimientos de inventario de cada producto (Drop: GET /products/{id}/stock-movements).
-- Entradas, salidas por orden y ajustes, tal como los registra la plataforma. `raw` guarda el
-- movimiento original para poder corregir el mapeo sin volver a descargar.
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  product_external_id text not null,
  external_id text not null,          -- ID del movimiento en la plataforma (o número si no hay ID)
  number integer,                     -- número correlativo que muestra la web ("45")
  units integer,                      -- con signo: + entrada, − salida
  balance integer,                    -- existencia después del movimiento (newQty)
  kind text,                          -- IN / OUT
  reason text,                        -- ORDER_DISPATCH, ORDER_RETURN, STOCK_REQUEST, RESERVE, RELEASE, MANUAL, INITIAL_STOCK…
  variant text,                       -- variante (talla, color) si aplica
  description text,                   -- "Salida por orden #1789…"
  order_number text,                  -- número de orden extraído de la descripción
  occurred_at timestamptz,
  raw jsonb not null,
  created_at timestamptz not null default now(),
  unique (account_id, product_external_id, external_id)
);

create index if not exists stock_movements_product_idx on public.stock_movements (account_id, product_external_id, occurred_at desc);
create index if not exists stock_movements_order_idx on public.stock_movements (account_id, order_number);

alter table public.stock_movements enable row level security;
revoke all on public.stock_movements from public, anon, authenticated;
grant all on public.stock_movements to service_role;

-- Cuándo se revisaron por última vez los movimientos de cada producto (se reparten entre sincronizaciones).
alter table public.products add column if not exists movements_sync_at timestamptz;
