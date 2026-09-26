-- Ficha 360° de una tienda (dropshipper): ventas, rentabilidad comercial, serie diaria,
-- productos, actividad y comparación con las demás tiendas de la misma cuenta.
-- Mismas definiciones que store_health (0010), para que la ficha y la lista coincidan:
--   sin canceladas/rechazadas; d7 / prev7 = últimas 168 h vs. las 168 h anteriores;
--   ticket, unidades por pedido y "te toca" = promedios de los últimos 30 días (720 h).
-- Días = fecha local de la cuenta. La serie trae los últimos 90 días, con los días en cero.
create or replace function public.store_detail(p_account uuid, p_store_id text)
returns jsonb language sql stable as $$
  with acc as (
    select a.id, a.name, a.currency, a.timezone, a.platform, a.country, (now() at time zone a.timezone)::date as today
    from public.accounts a where a.id = p_account
  ),
  -- todos los pedidos de la tienda (también cancelados, solo para identificarla)
  base as (
    select o.id, o.ordered_at, (o.ordered_at at time zone acc.timezone)::date as d, o.total, o.vendor_amount, o.dropshipper,
      coalesce(o.currency, acc.currency) as currency,
      public.status_group(o.status_code) as g,
      public.status_group(o.status_code) is distinct from 'cancelled' as ok
    from public.orders o join acc on acc.id = o.account_id
    where o.dropshipper is not null
      and coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) = p_store_id
  ),
  units as (
    select i.order_id, sum(i.quantity) as u
    from public.order_items i join base b on b.id = i.order_id
    where b.ok and b.ordered_at >= now() - interval '91 days'
    group by 1
  ),
  s as (
    select b.*, u.u from base b left join units u on u.order_id = b.id where b.ok
  ),
  kpis as (
    select
      count(*) filter (where s.d = acc.today) as today,
      count(*) filter (where s.ordered_at >= now() - interval '7 days') as d7,
      count(*) filter (where s.ordered_at >= now() - interval '14 days' and s.ordered_at < now() - interval '7 days') as prev7,
      count(*) filter (where s.ordered_at >= now() - interval '30 days') as n30,
      coalesce(sum(s.total) filter (where s.ordered_at >= now() - interval '30 days'), 0) as sales30,
      coalesce(sum(s.vendor_amount) filter (where s.ordered_at >= now() - interval '30 days'), 0) as vendor30,
      round(avg(s.total) filter (where s.ordered_at >= now() - interval '30 days'), 2) as ticket,
      round(avg(s.vendor_amount) filter (where s.ordered_at >= now() - interval '30 days'), 2) as vendor_per_order,
      round(avg(s.u) filter (where s.ordered_at >= now() - interval '30 days'), 2) as units_per_order,
      count(*) filter (where s.g = 'delivered' and s.ordered_at >= now() - interval '30 days') as delivered30,
      count(*) filter (where s.g = 'failed' and s.ordered_at >= now() - interval '30 days') as failed30,
      count(distinct s.d) filter (where s.d > acc.today - 7) as active7,
      count(distinct s.d) filter (where s.d > acc.today - 14 and s.d <= acc.today - 7) as active_prev7,
      max(s.ordered_at) as last_at,
      acc.today - max(s.d) as days_since,
      min(s.ordered_at) as first_at
    from s cross join acc
    group by acc.today
  ),
  by_day as (
    select s.d, count(*) as orders, sum(s.total) as sales, sum(s.u) as units from s group by 1
  ),
  products as (
    select l.product_key,
      (array_agg(l.product_name order by l.ordered_at desc))[1] as name,
      count(distinct l.order_id) as orders,
      sum(l.quantity) as units,
      round(sum(l.line_total), 2) as sales
    from public.line_facts l
    where l.account_id = p_account and l.store_id = p_store_id
      and l.ordered_at >= now() - interval '30 days' and l.grp is distinct from 'cancelled'
    group by 1
  ),
  -- tiendas de la cuenta con pedidos en 30 días (misma moneda y país)
  peer_orders as (
    select o.id, o.ordered_at, o.total,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id
    from public.orders o
    where o.account_id = p_account and o.dropshipper is not null
      and o.ordered_at >= now() - interval '30 days'
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  peers as (
    select po.store_id,
      count(*) filter (where po.ordered_at >= now() - interval '7 days') as d7,
      avg(po.total) as ticket,
      avg(iu.u) as upo
    from peer_orders po
    left join (select i.order_id, sum(i.quantity) as u
               from public.order_items i join peer_orders x on x.id = i.order_id group by 1) iu on iu.order_id = po.id
    group by 1
  )
  select case when not exists (select 1 from base) then null else jsonb_build_object(
    'store', (select jsonb_build_object(
        'account_id', acc.id, 'account_name', acc.name, 'platform', acc.platform, 'country', acc.country,
        'currency', coalesce((select max(currency) from base), acc.currency), 'timezone', acc.timezone,
        'store_id', p_store_id,
        'name', (select (array_agg(dropshipper order by ordered_at desc))[1] from base),
        'today', acc.today)
      from acc),
    'kpis', coalesce((select to_jsonb(k) from kpis k), jsonb_build_object(
        'today', 0, 'd7', 0, 'prev7', 0, 'n30', 0, 'sales30', 0, 'vendor30', 0, 'active7', 0, 'active_prev7', 0,
        'delivered30', 0, 'failed30', 0)),
    'daily', (select jsonb_agg(jsonb_build_object(
        'day', to_char(gs, 'YYYY-MM-DD'),
        'orders', coalesce(x.orders, 0), 'sales', coalesce(round(x.sales, 2), 0), 'units', coalesce(x.units, 0)
      ) order by gs)
      from acc, generate_series(acc.today - 89, acc.today, interval '1 day') gs
      left join by_day x on x.d = gs::date),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'product_key', p.product_key, 'name', p.name, 'orders', p.orders, 'units', p.units, 'sales', p.sales,
        'share', round(p.orders::numeric / nullif(k.n30, 0), 4)
      ) order by p.orders desc, p.units desc)
      from products p cross join kpis k), '[]'::jsonb),
    'activity', jsonb_build_object(
      'best30', (select jsonb_build_object('day', to_char(b.d, 'YYYY-MM-DD'), 'orders', b.orders)
                 from by_day b, acc where b.d > acc.today - 30 order by b.orders desc, b.d desc limit 1),
      'record', (select jsonb_build_object('day', to_char(b.d, 'YYYY-MM-DD'), 'orders', b.orders)
                 from by_day b order by b.orders desc, b.d desc limit 1)),
    'benchmark', (select jsonb_build_object(
        'stores', count(*),
        'orders_per_day', round(avg(p.d7) / 7.0, 2),
        'ticket', round(avg(p.ticket), 2),
        'units_per_order', round(avg(p.upo), 2),
        'rank_d7', (select count(*) + 1 from peers q where q.d7 > coalesce((select d7 from peers r where r.store_id = p_store_id), 0)))
      from peers p)
  ) end
$$;

revoke all on function public.store_detail(uuid, text) from public, anon, authenticated;
grant execute on function public.store_detail(uuid, text) to service_role;
