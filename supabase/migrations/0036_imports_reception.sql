-- Importaciones (fase 2): lo que se contó al recibir cada producto en la bodega, y búsqueda por
-- producto para que Inventario cuente lo que viene en camino en las importaciones.

alter table public.import_items
  add column if not exists received_qty  integer check (received_qty >= 0),       -- null: todavía no se cuenta
  add column if not exists damaged_qty   integer not null default 0 check (damaged_qty >= 0),
  add column if not exists received_note text,
  add column if not exists received_at   timestamptz,
  add column if not exists received_by   uuid references public.app_users(id) on delete set null;

do $$ begin
  alter table public.import_items add constraint import_items_damaged_le_received
    check (received_qty is null or damaged_qty <= received_qty);
exception when duplicate_object then null;
end $$;

create index if not exists import_items_product_idx on public.import_items (account_id, product_external_id)
  where product_external_id is not null;
