-- Fase 0 de gestión: estados que faltaban, historial de stock y refresco de pedidos abiertos.

-- "-1" = Envío creado (aún sin recolectar), "12" = En agencia. Mantener sincronizado con lib/status.ts.
create or replace function public.status_group(code text)
returns text language sql immutable as $$
  select case
    when code in ('registered', 'pending', 'fulfilled', '-1') then 'dispatch'
    when code in ('1', '2', '3', '12') then 'transit'
    when code = '4' then 'delivered'
    when code in ('pending_correction', '6') then 'problem'
    when code in ('7', '8') then 'failed'
    when code in ('5', 'cancelled', 'rejected') then 'cancelled'
    else null
  end
$$;

reindex index public.orders_group_idx;

-- Cada sync sobrescribe products.stock; aquí queda un registro cada vez que cambia.
-- Sirve para rotación, quiebres, sell-through y para saber cuándo descuenta Drop el stock.
create table if not exists public.product_stock_snapshots (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  taken_at    timestamptz not null default now(),
  stock       integer,
  in_stock    boolean
);

create index if not exists product_stock_snapshots_product_idx on public.product_stock_snapshots (product_id, taken_at desc);
create index if not exists product_stock_snapshots_account_idx on public.product_stock_snapshots (account_id, taken_at desc);

alter table public.product_stock_snapshots enable row level security;

create or replace function public.log_product_stock()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.stock is distinct from old.stock then
    insert into public.product_stock_snapshots (product_id, account_id, stock, in_stock)
    values (new.id, new.account_id, new.stock, (new.raw->>'isInStock')::boolean);
  end if;
  return new;
end
$$;

drop trigger if exists products_stock_history on public.products;
create trigger products_stock_history
  after insert or update of stock on public.products
  for each row execute function public.log_product_stock();

-- Punto de partida: el stock actual de todo el catálogo.
insert into public.product_stock_snapshots (product_id, account_id, stock, in_stock)
select p.id, p.account_id, p.stock, (p.raw->>'isInStock')::boolean
from public.products p
where not exists (select 1 from public.product_stock_snapshots s where s.product_id = p.id);

-- Última vez que se refrescaron los pedidos abiertos más antiguos que la ventana reciente.
alter table public.accounts add column if not exists open_refresh_at timestamptz;
