-- Tienda × producto comparativo: además del período elegido (7, 30 o 90 días), el período anterior
-- del mismo largo, para ver qué tiendas y qué productos suben o bajan sin sacar un Excel.
-- Agrega (sin quitar nada de lo que ya usan Oportunidades y la venta cruzada):
--   cells:    p (pedidos en el período anterior) y last_at (día local del último pedido de ese producto)
--   stores:   orders_prev, skus_prev, active_days (días con pedidos en el período), units y sales
--             (del período), last_at (día local del último pedido), today (hoy en la cuenta) y el último contacto de los
--             últimos 60 días con sus pedidos 7 días antes y 7 días desde el contacto (fu_*)
--   products: orders_prev, stores (tiendas en el período) y stores_prev
-- La ventana es de 90 días o de dos períodos (180 con 90 días). Sin cancelados ni rechazados.
create or replace function public.store_product_matrix(p_account uuid, p_days int)
returns jsonb language sql stable as $$
  with prm as (select least(greatest(coalesce(p_days, 30), 1), 90) as d),
  ord as (
    select o.id as order_id, o.account_id, o.ordered_at, o.dropshipper, o.total,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
      (o.ordered_at at time zone a.timezone)::date as day,
      (now() at time zone a.timezone)::date as today,
      o.ordered_at >= now() - make_interval(days => prm.d) as in_period,
      o.ordered_at < now() - make_interval(days => prm.d) and o.ordered_at >= now() - make_interval(days => 2 * prm.d) as in_prev,
      o.ordered_at >= now() - interval '90 days' as in_90
    from public.orders o
    join public.accounts a on a.id = o.account_id
    cross join prm
    where o.ordered_at >= now() - make_interval(days => greatest(90, 2 * prm.d))
      and o.dropshipper is not null
      and (p_account is null or o.account_id = p_account)
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  lines as (
    select ord.*, coalesce(i.product_external_id, 'sku:' || i.sku) as product_key, i.product_external_id, i.product_name, i.quantity
    from ord join public.order_items i on i.order_id = ord.order_id
  ),
  -- un pedido por tienda y producto
  sp as (
    select account_id, store_id, product_key, order_id,
      bool_or(in_period) as in_period, bool_or(in_prev) as in_prev, bool_or(in_90) as in_90, max(day) as at
    from lines where product_key is not null group by 1, 2, 3, 4
  ),
  cells as (
    select account_id, store_id, product_key,
      count(*) filter (where in_period) as n, count(*) filter (where in_prev) as p, count(*) filter (where in_90) as n90,
      max(at) as last_at
    from sp group by 1, 2, 3
  ),
  units as (select order_id, sum(quantity) as u from lines group by 1),
  stores as (
    select o.account_id, o.store_id, (array_agg(o.dropshipper order by o.ordered_at desc))[1] as name,
      count(*) filter (where o.in_period) as orders,
      count(*) filter (where o.in_prev) as orders_prev,
      count(*) filter (where o.in_90) as orders90,
      count(distinct o.day) filter (where o.in_period) as active_days,
      coalesce(sum(u.u) filter (where o.in_period), 0) as units,
      coalesce(sum(o.total) filter (where o.in_period), 0) as sales,
      max(o.day) as last_at,
      max(o.today) as today
    from ord o left join units u on u.order_id = o.order_id
    group by 1, 2
  ),
  skus as (
    select account_id, store_id, count(*) filter (where n > 0) as skus, count(*) filter (where p > 0) as skus_prev
    from cells group by 1, 2
  ),
  -- último contacto (seguimiento) de los últimos 60 días: pedidos 7 días antes y 7 días desde ese día
  fu as (
    select distinct on (f.account_id, f.store_id) f.account_id, f.store_id, f.contacted_at
    from public.store_followups f
    where f.contacted_at >= current_date - 60 and (p_account is null or f.account_id = p_account)
    order by f.account_id, f.store_id, f.contacted_at desc, f.created_at desc
  ),
  impact as (
    select f.account_id, f.store_id, f.contacted_at,
      count(o.order_id) filter (where o.day >= f.contacted_at - 7 and o.day < f.contacted_at) as before7,
      count(o.order_id) filter (where o.day >= f.contacted_at and o.day < f.contacted_at + 7) as after7
    from fu f left join ord o on o.account_id = f.account_id and o.store_id = f.store_id
    group by 1, 2, 3
  ),
  products as (
    select l.account_id, l.product_key,
      coalesce(max(pr.name), (array_agg(l.product_name order by l.ordered_at desc))[1]) as name,
      count(distinct l.order_id) filter (where l.in_period) as orders,
      count(distinct l.order_id) filter (where l.in_prev) as orders_prev,
      count(distinct l.order_id) filter (where l.in_90) as orders90,
      count(distinct l.store_id) filter (where l.in_90) as stores90,
      count(distinct l.store_id) filter (where l.in_period) as stores,
      count(distinct l.store_id) filter (where l.in_prev) as stores_prev
    from lines l
    left join public.products pr on pr.account_id = l.account_id and pr.external_id = l.product_external_id
    where l.product_key is not null
    group by 1, 2
  )
  select jsonb_build_object(
    'days', (select d from prm),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('account_id', a.id, 'account_name', a.name, 'currency', a.currency) order by a.name)
                          from public.accounts a where a.id in (select account_id from stores)), '[]'::jsonb),
    'stores', coalesce((
      select jsonb_agg(jsonb_build_object(
          'account_id', s.account_id, 'store_id', s.store_id, 'name', s.name,
          'orders', s.orders, 'orders_prev', s.orders_prev, 'orders90', s.orders90,
          'skus', coalesce(k.skus, 0), 'skus_prev', coalesce(k.skus_prev, 0),
          'active_days', s.active_days, 'units', s.units, 'sales', s.sales, 'last_at', s.last_at, 'today', s.today,
          'fu_at', i.contacted_at, 'fu_before', i.before7, 'fu_after', i.after7
        ) order by s.orders desc, s.orders_prev desc)
      from stores s
      left join skus k on k.account_id = s.account_id and k.store_id = s.store_id
      left join impact i on i.account_id = s.account_id and i.store_id = s.store_id), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.orders desc, p.orders_prev desc) from products p), '[]'::jsonb),
    'cells', coalesce((select jsonb_agg(to_jsonb(c)) from cells c), '[]'::jsonb)
  )
$$;

revoke all on function public.store_product_matrix(uuid, int) from public, anon, authenticated;
grant execute on function public.store_product_matrix(uuid, int) to service_role;
