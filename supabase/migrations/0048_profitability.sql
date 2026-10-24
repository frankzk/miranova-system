-- Rentabilidad: ficha de costos por producto, precios por cuenta y utilidad real de lo entregado.
--
-- profit_products  un producto con sus costos comunes (costo, importación, recolección en GT), en
--                  dólares o quetzales.
-- profit_markets   el producto en cada cuenta: traslado al país (Raulito, Castañeda…), precio
--                  comunidad y usuarios (en la moneda de la cuenta) y cantidad ingresada.
-- profit_links     qué producto de Drop/Dropi (cuenta + product_key, como line_facts) es esa ficha.
--                  Un producto de la plataforma pertenece a una sola ficha.

create table if not exists public.profit_products (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 160),
  cost_currency  text not null default 'USD' check (cost_currency in ('USD', 'GTQ')),
  fx_gtq_per_usd numeric(10, 4) check (fx_gtq_per_usd > 0),
  unit_cost      numeric(12, 4) check (unit_cost >= 0),
  import_cost    numeric(12, 4) check (import_cost >= 0),
  pickup_cost    numeric(12, 4) check (pickup_cost >= 0),
  notes          text check (length(notes) <= 2000),
  created_by     uuid references public.app_users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists profit_products_name_idx on public.profit_products (lower(btrim(name)));

create table if not exists public.profit_markets (
  product_id      uuid not null references public.profit_products(id) on delete cascade,
  account_id      uuid not null references public.accounts(id) on delete cascade,
  carrier         text check (carrier in ('raulito', 'castaneda', 'otro')),
  transfer_cost   numeric(12, 4) check (transfer_cost >= 0),  -- por unidad, en la moneda de costos del producto
  price_community numeric(12, 2) check (price_community >= 0), -- en la moneda de la cuenta
  price_users     numeric(12, 2) check (price_users >= 0),
  qty_in          integer check (qty_in >= 0),
  primary key (product_id, account_id)
);

create table if not exists public.profit_links (
  account_id  uuid not null references public.accounts(id) on delete cascade,
  product_key text not null check (length(product_key) between 1 and 200),
  product_id  uuid not null references public.profit_products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (account_id, product_key)
);

create index if not exists profit_links_product_idx on public.profit_links (product_id);

alter table public.profit_products enable row level security;
alter table public.profit_markets  enable row level security;
alter table public.profit_links    enable row level security;

-- Lo entregado desde p_from, por día (en la zona de la cuenta) × cuenta × producto × precio por
-- unidad. Día = fecha de entrega (si falta, la de liquidación o la del pedido); con
-- p_basis = 'ordered', la fecha del pedido. v = lo que cobra el proveedor (moneda de la cuenta);
-- f = lo que descontó la plataforma (fulfillment y comisiones), repartido entre las líneas del
-- pedido según su monto; x = parte de pedidos sin ese dato (se estima con el fulfillment fijo).
create or replace function public.profit_delivered(p_from date, p_basis text default 'delivered')
returns jsonb language sql stable as $$
  with o as (
    select o.id, o.account_id, o.vendor_amount, o.vendor_net, o.raw,
      ((case when p_basis = 'ordered' then o.ordered_at else coalesce(
        (select min((e->>'occurredAt')::timestamptz)
           from jsonb_array_elements(case when jsonb_typeof(o.raw->'orderInfo'->'statusTimeline') = 'array'
                                          then o.raw->'orderInfo'->'statusTimeline' else '[]'::jsonb end) e
          where e->>'status' = '4'),
        (o.raw->'payment'->>'paidAt')::timestamptz,
        o.ordered_at) end) at time zone a.timezone)::date as day
    from public.orders o join public.accounts a on a.id = o.account_id
    where public.status_group(o.status_code) = 'delivered'
      -- se entrega días después del pedido: margen amplio para no perder entregas lentas
      and o.ordered_at >= p_from - interval '120 days'
  ),
  d as (select * from o where day >= p_from),
  -- Drop: productSnapshots (el precio de línea ya viene por la cantidad); Dropi: orderdetails (unitario)
  l as (
    select d.id, d.account_id, d.day, d.vendor_amount, d.vendor_net,
      coalesce(p->>'productId', 'sku:' || (p->>'sku')) as k,
      p->>'productName' as name,
      greatest(coalesce((p->>'quantity')::int, 1), 1) as q,
      coalesce((p->>'vendorPrice')::numeric, 0) as v
    from d, jsonb_array_elements(case when jsonb_typeof(d.raw->'productSnapshots') = 'array'
                                      then d.raw->'productSnapshots' else '[]'::jsonb end) p
    union all
    select d.id, d.account_id, d.day, d.vendor_amount, d.vendor_net,
      coalesce(p->'product'->>'id', p->>'product_id', 'sku:' || coalesce(p->'variation'->>'sku', p->'product'->>'sku')),
      p->'product'->>'name',
      greatest(coalesce((p->>'quantity')::int, 1), 1),
      coalesce((p->>'supplier_price')::numeric, 0) * greatest(coalesce((p->>'quantity')::int, 1), 1)
    from d, jsonb_array_elements(case when jsonb_typeof(d.raw->'orderdetails') = 'array'
                                      then d.raw->'orderdetails' else '[]'::jsonb end) p
  ),
  w as (
    select l.*, round(v / q, 2) as p,
      case when sum(v) over (partition by id) > 0 then v / sum(v) over (partition by id)
           else 1.0 / count(*) over (partition by id) end as share
    from l
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('d', day, 'a', account_id, 'k', k, 'p', p, 'u', u, 'v', v, 'f', f, 'x', x, 'n', n))
      from (
        select day, account_id, k, p, sum(q) as u, sum(v) as v,
          round(sum(share * (vendor_amount - vendor_net)) filter (where vendor_amount is not null and vendor_net is not null), 2) as f,
          round(sum(share) filter (where vendor_amount is null or vendor_net is null), 4) as x,
          count(distinct id) as n
        from w group by 1, 2, 3, 4
      ) r), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('d', day, 'a', account_id, 'n', n))
      from (select day, account_id, count(*) as n from d group by 1, 2) r), '[]'::jsonb),
    'names', coalesce((
      select jsonb_object_agg(key, name)
      from (select distinct on (account_id, k) account_id || ':' || k as key, name
            from l where name is not null order by account_id, k, day desc) r), '{}'::jsonb)
  )
$$;

revoke all on function public.profit_delivered(date, text) from public, anon, authenticated;
grant execute on function public.profit_delivered(date, text) to service_role;
