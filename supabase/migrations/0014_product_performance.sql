-- Rendimiento de productos: una fila por producto y cuenta, con ritmo (7 días vs. 7 anteriores),
-- cuántas tiendas lo venden, pedidos por tienda, ticket y unidades por pedido.
-- Misma identidad de producto que line_facts (product_key = ID del producto en la plataforma,
-- o "sku:<sku>"), pero leída de order_items (ya normalizado) para no parsear el JSON de cada pedido.
-- Sin órdenes canceladas/rechazadas. Ventanas como store_health (0010):
--   d7 / prev7: últimas 168 h vs. las 168 h anteriores
--   30 días: pedidos, unidades, tiendas que lo venden, ticket (total promedio de los pedidos que lo incluyen)
--   daily: pedidos por día local de los últimos 14 días (mini gráfica)
-- Cada fila trae además las tiendas activas de su cuenta (con pedidos en 30 días / 7 días) para medir
-- cobertura, y los productos del catálogo activos sin pedidos en 30 días (orders30 = 0).
create or replace function public.product_performance(p_account uuid)
returns jsonb language sql stable as $$
  with lines as (
    select o.id order_id, o.account_id, o.ordered_at, o.total,
      (o.ordered_at at time zone a.timezone)::date d, (now() at time zone a.timezone)::date today,
      case when o.dropshipper is not null
        then coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) end store_id,
      coalesce(i.product_external_id, 'sku:' || i.sku) product_key, i.product_external_id, i.product_name,
      greatest(coalesce(i.quantity, 1), 1) quantity
    from public.orders o
    join public.accounts a on a.id = o.account_id
    join public.order_items i on i.order_id = o.id
    where o.ordered_at >= now() - interval '30 days'
      and (p_account is null or o.account_id = p_account)
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  -- un pedido por producto (dos variantes del mismo producto en un pedido cuentan una vez)
  po as (
    select account_id, product_key, order_id, max(product_external_id) product_external_id,
      max(product_name) product_name, max(ordered_at) ordered_at, max(total) total, max(store_id) store_id,
      sum(quantity) units, max(d) d, max(today) today
    from lines where product_key is not null
    group by 1, 2, 3
  ),
  acc as (
    select account_id,
      count(distinct store_id) active_stores30,
      count(distinct store_id) filter (where ordered_at >= now() - interval '7 days') active_stores7
    from lines group by 1
  ),
  daily as (
    select account_id, product_key, d, count(*) n from po where d > today - 14 group by 1, 2, 3
  ),
  sold as (
    select account_id, product_key, max(product_external_id) product_external_id,
      (array_agg(product_name order by ordered_at desc))[1] name_at_sale,
      count(*) filter (where ordered_at >= now() - interval '7 days') orders7,
      count(*) filter (where ordered_at >= now() - interval '14 days' and ordered_at < now() - interval '7 days') prev7,
      count(*) orders30,
      sum(units) units30,
      count(distinct store_id) stores30,
      count(distinct store_id) filter (where ordered_at >= now() - interval '7 days') stores7,
      round(avg(total), 2) ticket,
      max(today) today
    from po group by 1, 2
  ),
  catalog as (
    select p.account_id, p.external_id product_key, p.id product_id, p.name, p.image_url, p.status, p.stock, p.created_at_platform
    from public.products p
    where (p_account is null or p.account_id = p_account)
  ),
  prods as (
    select s.account_id, s.product_key, c.product_id, coalesce(c.name, s.name_at_sale) name, c.image_url, c.status, c.stock,
      c.created_at_platform, s.orders7, s.prev7, s.orders30, s.units30, s.stores30, s.stores7, s.ticket, s.today
    from sold s left join catalog c on c.account_id = s.account_id and c.product_key = s.product_external_id
    union all
    select c.account_id, c.product_key, c.product_id, c.name, c.image_url, c.status, c.stock, c.created_at_platform,
      0, 0, 0, 0, 0, 0, null, (now() at time zone a.timezone)::date
    from catalog c join public.accounts a on a.id = c.account_id
    where c.status = 'Activo'
      and not exists (select 1 from sold s where s.account_id = c.account_id and s.product_external_id = c.product_key)
  ),
  -- primer pedido histórico (respaldo cuando el catálogo no trae fecha de alta)
  first_order as (
    select o.account_id, coalesce(i.product_external_id, 'sku:' || i.sku) product_key, min(o.ordered_at) first_order_at
    from public.orders o join public.order_items i on i.order_id = o.id
    where (p_account is null or o.account_id = p_account)
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', r.account_id, 'account_name', a.name, 'currency', a.currency,
      'product_key', r.product_key, 'product_id', r.product_id, 'name', r.name, 'image_url', r.image_url,
      'status', r.status, 'stock', r.stock, 'created_at', r.created_at_platform, 'first_order_at', f.first_order_at,
      'orders7', r.orders7, 'prev7', r.prev7, 'orders30', r.orders30, 'units30', r.units30,
      'stores30', r.stores30, 'stores7', r.stores7, 'ticket', r.ticket,
      'active_stores30', coalesce(ac.active_stores30, 0), 'active_stores7', coalesce(ac.active_stores7, 0),
      'daily', (select jsonb_agg(coalesce(dl.n, 0) order by gs)
                from generate_series(r.today - 13, r.today, interval '1 day') gs
                left join daily dl on dl.account_id = r.account_id and dl.product_key = r.product_key and dl.d = gs::date)
    ) order by r.orders30 desc, r.name), '[]'::jsonb)
  from prods r
  join public.accounts a on a.id = r.account_id
  left join acc ac on ac.account_id = r.account_id
  left join first_order f on f.account_id = r.account_id and f.product_key = r.product_key
$$;

revoke all on function public.product_performance(uuid) from public, anon, authenticated;
grant execute on function public.product_performance(uuid) to service_role;
