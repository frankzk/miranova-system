-- Productos → Catálogo: cuántas tiendas venden cada producto y, al abrirlo, cuáles.

-- product_sales: además de unidades y pedidos, cuántas tiendas distintas lo vendieron.
create or replace function public.product_sales(p_account uuid, p_from timestamptz)
returns jsonb
language sql stable
as $$
  with l as (
    select o.account_id, o.store_id, i.product_external_id, i.sku, i.product_name, i.quantity, o.id as order_id
    from public.orders o join public.order_items i on i.order_id = o.id
    where (p_account is null or o.account_id = p_account)
      and o.ordered_at >= p_from
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  keyed as (
    select account_id::text || ':' || coalesce(nullif(sku, ''), product_name) as k, quantity, order_id, store_id from l
    union all
    select account_id::text || ':id:' || product_external_id, quantity, order_id, store_id from l where product_external_id is not null
  )
  select coalesce(jsonb_object_agg(k, jsonb_build_object('units', units, 'orders', orders, 'stores', stores)), '{}'::jsonb) from (
    select k, sum(quantity) as units, count(distinct order_id) as orders, count(distinct store_id) as stores from keyed group by k
  ) s
$$;

-- Las tiendas que venden un producto del catálogo desde p_from: por el ID del producto en la
-- plataforma; si con ese ID no hay ventas, por SKU o nombre (igual que la columna "Vendido").
create or replace function public.product_stores(p_account uuid, p_external_id text, p_sku text, p_name text, p_from timestamptz)
returns jsonb
language sql stable
as $$
  with l as (
    select o.id order_id, o.store_id, o.dropshipper, o.ordered_at, i.product_external_id, i.sku, i.product_name, i.quantity
    from public.orders o join public.order_items i on i.order_id = o.id
    where o.account_id = p_account
      and o.ordered_at >= p_from
      and o.dropshipper is not null
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  by_id as (select * from l where p_external_id is not null and product_external_id = p_external_id),
  lines as (
    select * from by_id
    union all
    select * from l
    where not exists (select 1 from by_id)
      and coalesce(nullif(sku, ''), product_name) in (coalesce(nullif(p_sku, ''), p_name), p_name)
  ),
  per_store as (
    select store_id, (array_agg(dropshipper order by ordered_at desc))[1] name,
      sum(quantity) units, count(distinct order_id) orders, max(ordered_at) last_at
    from lines group by store_id
  )
  select jsonb_build_object(
    'units', coalesce((select sum(units) from per_store), 0),
    'orders', coalesce((select count(distinct order_id) from lines), 0),
    'stores', coalesce((select jsonb_agg(row_to_json(s) order by s.units desc, s.orders desc, s.name) from per_store s), '[]'::jsonb)
  )
$$;

revoke all on function public.product_stores(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.product_stores(uuid, text, text, text, timestamptz) to service_role;
