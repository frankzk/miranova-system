-- Solicitudes con varios productos: cada solicitud (pedido de una tienda) tiene una o más líneas de
-- producto y cantidad. store_requests.product y quantity quedan como resumen (el primer producto y
-- el total de unidades) para lo que todavía los lea; lo que vale son las líneas.

set lock_timeout = '5s';

create table if not exists public.store_request_items (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.store_requests(id) on delete cascade,
  position    integer not null default 0,
  product     text not null,
  quantity    integer not null check (quantity > 0),
  created_at  timestamptz not null default now()
);
create index if not exists store_request_items_request_idx on public.store_request_items (request_id, position);
alter table public.store_request_items enable row level security;

-- las solicitudes que ya existen pasan a tener su producto como primera línea
insert into public.store_request_items (request_id, position, product, quantity)
select r.id, 0, r.product, r.quantity
from public.store_requests r
where not exists (select 1 from public.store_request_items i where i.request_id = r.id);
