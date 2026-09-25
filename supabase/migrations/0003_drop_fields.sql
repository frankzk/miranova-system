-- Campos del formato real de Drop (/orders): envío, pago al proveedor y catálogo geográfico.

alter table public.orders
  add column if not exists status_code   text,
  add column if not exists tracking_url  text,
  add column if not exists label_url     text,
  add column if not exists shipping_cost numeric(12,2),
  add column if not exists vendor_amount numeric(12,2),   -- lo que cobra el proveedor
  add column if not exists vendor_net    numeric(12,2),   -- ganancia neta estimada
  add column if not exists cod           boolean,         -- pago contra entrega
  add column if not exists paid          boolean;         -- ya liquidado al proveedor

alter table public.order_items
  add column if not exists vendor_price numeric(12,2);

alter table public.accounts
  add column if not exists geo             jsonb,         -- { map: { id: nombre }, at }
  add column if not exists backfill_cursor timestamptz;   -- hasta dónde va la carga del historial

create index if not exists orders_status_code_idx on public.orders (status_code);
