-- Vista "Negocio": comparación entre países, flujo de tiendas, tendencia de productos y
-- operación, para un período (p_days) contra el período anterior de igual largo.
-- p_country filtra tiendas, productos y operación (los países se muestran siempre todos).
-- Pedidos = recibidos sin cancelados/rechazados. Tasas de entrega sobre pedidos ya cerrados
-- (entregados + no entregados) del período. Montos del proveedor en USD con account_fx.

create or replace function public.business_overview(p_account uuid, p_days int, p_country text)
returns jsonb language sql stable as $$
  with win as (
    select now() - make_interval(days => p_days) as cur_from,
           now() - make_interval(days => p_days * 2) as prev_from
  ),
  o as (
    select o.id, o.account_id, a.name as account_name, a.country, a.currency, o.ordered_at,
      public.status_group(o.status_code) as grp,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
      o.dropshipper as store_name, o.carrier, o.department, o.vendor_amount, o.vendor_net,
      o.ordered_at >= w.cur_from as is_cur
    from public.orders o
    join public.accounts a on a.id = o.account_id
    cross join win w
    where (p_account is null or o.account_id = p_account)
      and o.ordered_at >= w.prev_from
  ),
  fx as (select account_id, usd_rate from public.account_fx),

  -- Países (cuenta = país + plataforma)
  countries as (
    select o.account_id, max(o.account_name) as account, max(o.country) as country, max(o.currency) as currency,
      count(*) filter (where o.is_cur and o.grp is distinct from 'cancelled') as orders,
      count(*) filter (where not o.is_cur and o.grp is distinct from 'cancelled') as prev_orders,
      count(*) filter (where o.is_cur and o.grp = 'cancelled') as cancelled,
      count(*) filter (where o.is_cur) as received,
      count(*) filter (where o.is_cur and o.grp = 'delivered') as delivered,
      count(*) filter (where o.is_cur and o.grp = 'failed') as failed,
      round(coalesce(sum(o.vendor_net) filter (where o.is_cur and o.grp = 'delivered'), 0) * max(fx.usd_rate), 2) as net_usd,
      round(coalesce(sum(o.vendor_net) filter (where not o.is_cur and o.grp = 'delivered'), 0) * max(fx.usd_rate), 2) as prev_net_usd,
      count(distinct o.store_id) filter (where o.is_cur and o.grp is distinct from 'cancelled') as stores
    from o left join fx using (account_id)
    group by o.account_id
  ),

  -- Lo que sigue se filtra por país
  f as (select * from o where p_country is null or o.country = p_country),

  -- Tiendas: flujo (nuevas, perdidas, recuperadas, creciendo, cayendo) y concentración
  first_order as (
    select coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
      o.account_id, min(o.ordered_at) as first_at
    from public.orders o
    where (p_account is null or o.account_id = p_account) and o.dropshipper is not null
    group by 1, 2
  ),
  st as (
    select f.account_id, f.store_id, max(f.account_name) as account, max(f.country) as country,
      (array_agg(f.store_name order by f.ordered_at desc))[1] as name,
      count(*) filter (where f.is_cur and f.grp is distinct from 'cancelled') as cur,
      count(*) filter (where not f.is_cur and f.grp is distinct from 'cancelled') as prev,
      max(fo.first_at) as first_at
    from f join first_order fo on fo.store_id = f.store_id and fo.account_id = f.account_id
    where f.store_name is not null
    group by f.account_id, f.store_id
  ),
  st_class as (
    select st.*,
      case
        when st.cur > 0 and st.first_at >= (select cur_from from win) then 'new'
        when st.cur = 0 and st.prev > 0 then 'lost'
        when st.cur > 0 and st.prev = 0 then 'recovered'
        when st.prev >= 10 and st.cur <= st.prev * 0.65 then 'falling'
        when st.cur >= 10 and st.cur >= st.prev * 1.3 then 'growing'
        else 'steady'
      end as flow
    from st
  ),
  stores as (
    select
      (select count(*) from st_class where cur > 0) as active,
      (select count(*) from st_class where flow = 'new') as new,
      (select count(*) from st_class where flow = 'lost') as lost,
      (select count(*) from st_class where flow = 'recovered') as recovered,
      (select count(*) from st_class where flow = 'growing') as growing,
      (select count(*) from st_class where flow = 'falling') as falling,
      (select coalesce(sum(cur), 0) from st_class) as total,
      (select coalesce(jsonb_agg(jsonb_build_object('account', account, 'country', country, 'name', name,
          'cur', cur, 'prev', prev, 'flow', flow) order by cur desc), '[]'::jsonb)
         from (select * from st_class where cur > 0 order by cur desc limit 10) t) as top,
      (select coalesce(jsonb_agg(jsonb_build_object('account', account, 'country', country, 'name', name,
          'cur', cur, 'prev', prev, 'flow', flow) order by prev desc), '[]'::jsonb)
         from (select * from st_class where flow in ('lost', 'falling') order by prev - cur desc limit 8) t) as losing
  ),

  -- Productos: unidades del período vs. el anterior, tiendas que lo venden, entrega y neto en USD
  lines as (
    select f.account_id, f.account_name, f.country, f.is_cur, f.grp, f.id as order_id, f.store_id,
      coalesce(i.product_external_id, i.product_name) as pkey, i.product_external_id, i.product_name,
      i.quantity, i.vendor_price
    from f join public.order_items i on i.order_id = f.id
    where f.grp is distinct from 'cancelled'
  ),
  pr as (
    select l.account_id, l.pkey, max(l.account_name) as account, max(l.country) as country,
      coalesce(max(p.name), max(l.product_name)) as name,
      coalesce(sum(l.quantity) filter (where l.is_cur), 0) as units,
      coalesce(sum(l.quantity) filter (where not l.is_cur), 0) as prev_units,
      count(distinct l.store_id) filter (where l.is_cur) as stores,
      count(distinct l.order_id) filter (where l.is_cur and l.grp = 'delivered') as delivered,
      count(distinct l.order_id) filter (where l.is_cur and l.grp = 'failed') as failed,
      round(coalesce(sum(l.vendor_price) filter (where l.is_cur and l.grp = 'delivered'), 0) * max(fx.usd_rate), 2) as vendor_usd
    from lines l
    left join public.products p on p.account_id = l.account_id and p.external_id = l.product_external_id
    left join fx on fx.account_id = l.account_id
    group by l.account_id, l.pkey
  ),
  products as (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.units desc, t.prev_units desc), '[]'::jsonb) from (
      select account, country, name, units, prev_units, stores, delivered, failed, vendor_usd
      from pr where units > 0 or prev_units >= 20
      order by units desc, prev_units desc limit 40
    ) t
  ),

  -- Operación: por paquetera (entrega y tiempos del historial de estados) y por departamento
  tl as (
    select f.id,
      min((e->>'occurredAt')::timestamptz) filter (where e->>'status' = 'fulfilled') as dispatched_at,
      min((e->>'occurredAt')::timestamptz) filter (where e->>'status' = '2') as picked_at,
      min((e->>'occurredAt')::timestamptz) filter (where e->>'status' = '4') as delivered_at
    from f join public.orders x on x.id = f.id,
      jsonb_array_elements(case when jsonb_typeof(x.raw->'orderInfo'->'statusTimeline') = 'array'
                                then x.raw->'orderInfo'->'statusTimeline' else '[]'::jsonb end) e
    where f.is_cur and f.grp in ('transit', 'problem', 'delivered', 'failed')
    group by f.id
  ),
  carriers as (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.orders desc), '[]'::jsonb) from (
      select f.carrier as name, max(f.account_name) as account, max(f.country) as country,
        count(*) filter (where f.grp is distinct from 'cancelled') as orders,
        count(*) filter (where f.grp = 'delivered') as delivered,
        count(*) filter (where f.grp = 'failed') as failed,
        round((percentile_cont(0.5) within group (order by extract(epoch from t.dispatched_at - f.ordered_at) / 3600))::numeric, 1) as h_to_dispatch,
        round((percentile_cont(0.5) within group (order by extract(epoch from t.delivered_at - t.picked_at) / 86400))::numeric, 1) as d_to_deliver,
        round((percentile_cont(0.9) within group (order by extract(epoch from t.delivered_at - t.picked_at) / 86400))::numeric, 1) as d_to_deliver_p90
      from f left join tl t on t.id = f.id
      where f.is_cur and f.carrier is not null
      group by f.account_id, f.carrier
      having count(*) filter (where f.grp is distinct from 'cancelled') >= 5
    ) t
  ),
  departments as (
    select coalesce(jsonb_agg(to_jsonb(t) order by t.rate asc, t.closed desc), '[]'::jsonb) from (
      select f.department as name, max(f.account_name) as account, max(f.country) as country,
        count(*) filter (where f.grp in ('delivered', 'failed')) as closed,
        count(*) filter (where f.grp = 'failed') as failed,
        round(count(*) filter (where f.grp = 'delivered')::numeric
              / nullif(count(*) filter (where f.grp in ('delivered', 'failed')), 0), 3) as rate
      from f
      where f.is_cur and f.department is not null
      group by f.account_id, f.department
      having count(*) filter (where f.grp in ('delivered', 'failed')) >= 20
      order by rate asc, closed desc limit 8
    ) t
  )
  select jsonb_build_object(
    'days', p_days,
    'country', p_country,
    'countries', coalesce((select jsonb_agg(to_jsonb(c) order by c.orders desc) from countries c), '[]'::jsonb),
    'stores', (select to_jsonb(s) from stores s),
    'products', (select * from products),
    'carriers', (select * from carriers),
    'departments', (select * from departments)
  )
$$;

revoke all on function public.business_overview(uuid, int, text) from public, anon, authenticated;
grant execute on function public.business_overview(uuid, int, text) to service_role;
