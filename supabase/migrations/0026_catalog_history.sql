-- Historial de precio y stock del catálogo de la competencia.
-- Cada sync sobrescribe catalog_products; aquí queda un registro cada vez que
-- cambia el costo, el sugerido o el stock, para detectar re-precios y quiebres.
-- Mismo patrón que product_stock_snapshots (migración 0007).

create table if not exists public.catalog_history (
  id                  bigint generated always as identity primary key,
  catalog_product_id  uuid not null references public.catalog_products(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,
  taken_at            timestamptz not null default now(),
  cost                numeric(12,2),
  suggested           numeric(12,2),
  stock               integer
);

create index if not exists catalog_history_product_idx on public.catalog_history (catalog_product_id, taken_at desc);
create index if not exists catalog_history_account_idx on public.catalog_history (account_id, taken_at desc);

alter table public.catalog_history enable row level security;

-- El historial lo escribe la app (lib/store.ts → saveCatalog): inserta un renglón
-- cuando cambia costo, sugerido o stock de un producto. Se hace en la app en vez de
-- con un trigger para no depender de un lock exclusivo sobre catalog_products.

-- Punto de partida: el estado actual de todo el catálogo ya guardado.
insert into public.catalog_history (catalog_product_id, account_id, cost, suggested, stock)
select c.id, c.account_id, c.cost, c.suggested, c.stock
from public.catalog_products c
where not exists (select 1 from public.catalog_history h where h.catalog_product_id = c.id);

-- Cambios (foto nueva vs. anterior por producto) de los últimos p_days, más recientes primero.
create or replace function public.catalog_changes(p_account uuid, p_days int default 30)
returns jsonb language sql stable as $$
  with h as (
    select ch.catalog_product_id, ch.taken_at, ch.cost, ch.suggested, ch.stock,
           lag(ch.cost)      over w as prev_cost,
           lag(ch.suggested) over w as prev_suggested,
           lag(ch.stock)     over w as prev_stock
    from public.catalog_history ch
    where (p_account is null or ch.account_id = p_account)
    window w as (partition by ch.catalog_product_id order by ch.taken_at)
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.taken_at desc), '[]'::jsonb)
  from (
    select cp.name, cp.vendor, cp.code, cp.currency, h.taken_at,
           h.prev_cost, h.cost, h.prev_suggested, h.suggested, h.prev_stock, h.stock
    from h
    join public.catalog_products cp on cp.id = h.catalog_product_id
    where h.taken_at >= now() - (p_days * interval '1 day')
      and (h.prev_cost is not null or h.prev_suggested is not null or h.prev_stock is not null)
      and (h.cost is distinct from h.prev_cost
        or h.suggested is distinct from h.prev_suggested
        or h.stock is distinct from h.prev_stock)
    order by h.taken_at desc
    limit 500
  ) x
$$;

revoke all on function public.catalog_changes(uuid, int) from public, anon, authenticated;
grant execute on function public.catalog_changes(uuid, int) to service_role;

-- Movimiento de stock por producto en una ventana: unidades que bajaron (lo que la
-- competencia movió), unidades que subieron (reabastos) y cuándo fue el último cambio.
create or replace function public.catalog_movement(p_account uuid, p_days int default 30)
returns jsonb language sql stable as $$
  with hist as (
    select h.catalog_product_id, h.account_id, h.taken_at, h.stock,
           lag(h.stock) over (partition by h.catalog_product_id order by h.taken_at) as prev_stock
    from public.catalog_history h
    where (p_account is null or h.account_id = p_account)
  ),
  win as (
    select * from hist
    where taken_at >= now() - (p_days * interval '1 day') and prev_stock is not null
  ),
  agg as (
    select catalog_product_id,
      coalesce(sum(greatest(prev_stock - stock, 0)), 0) as units_down,
      coalesce(sum(greatest(stock - prev_stock, 0)), 0) as units_up,
      count(*) filter (where stock is distinct from prev_stock) as stock_changes,
      max(taken_at) filter (where stock is distinct from prev_stock) as last_move
    from win group by catalog_product_id
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.units_down desc, x.stock_changes desc, x.name), '[]'::jsonb)
  from (
    select cp.code, cp.name, cp.vendor, cp.currency, cp.image_url,
           cp.cost, cp.suggested, cp.stock,
           coalesce(a.units_down, 0) as units_down,
           coalesce(a.units_up, 0) as units_up,
           coalesce(a.stock_changes, 0) as stock_changes,
           a.last_move
    from public.catalog_products cp
    left join agg a on a.catalog_product_id = cp.id
    where (p_account is null or cp.account_id = p_account)
  ) x
$$;

revoke all on function public.catalog_movement(uuid, int) from public, anon, authenticated;
grant execute on function public.catalog_movement(uuid, int) to service_role;
