-- "Atención del dueño": hallazgos del día que piden una decisión, calculados en la base.
-- Cada alerta trae su gravedad (1 = hoy, 2 = esta semana, 3 = oportunidad), un puntaje
-- para ordenarlas y los datos para armar el texto y el enlace en el panel.
-- Umbrales iniciales: se ajustan aquí según lo que resulte útil o ruido.

create or replace function public.owner_alerts(p_account uuid)
returns jsonb language sql stable as $$
  with o as (
    select o.id, o.account_id, o.ordered_at, public.status_group(o.status_code) as grp,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
      o.dropshipper as store_name, o.carrier, o.vendor_amount, o.paid
    from public.orders o
    join public.accounts a on a.id = o.account_id
    where a.enabled
      and (p_account is null or o.account_id = p_account)
      and o.ordered_at >= now() - interval '120 days'
  ),
  timeline as (
    select o.id,
      max((e->>'occurredAt')::timestamptz) as last_change,
      min((e->>'occurredAt')::timestamptz) filter (where e->>'status' = '4') as delivered_at
    -- el JSON se lee de la tabla solo para estos pedidos (no se copia en `o`)
    from o join public.orders x on x.id = o.id,
      jsonb_array_elements(case when jsonb_typeof(x.raw->'orderInfo'->'statusTimeline') = 'array'
                                then x.raw->'orderInfo'->'statusTimeline' else '[]'::jsonb end) e
    -- solo los pedidos que lo necesitan: abiertos, o entregados y aún sin liquidar
    where o.grp in ('transit', 'problem') or (o.grp = 'delivered' and not coalesce(o.paid, false))
    group by o.id
  ),

  -- Cuentas (país + plataforma): semana actual contra la anterior.
  acct as (
    select account_id,
      count(*) filter (where ordered_at >= now() - interval '7 days') as cur,
      count(*) filter (where ordered_at >= now() - interval '14 days' and ordered_at < now() - interval '7 days') as prev,
      max(ordered_at) as last_order
    from o group by 1
  ),
  a_alerts as (
    select
      case when cur = 0 then 'account_stalled' when cur < prev then 'account_drop' else 'account_growth' end as kind,
      case when cur = 0 then 1 when cur < prev then 2 else 3 end as sev,
      account_id,
      jsonb_build_object('cur', cur, 'prev', prev, 'last_order', last_order) as data,
      abs(cur - prev)::numeric as score
    from acct
    where (prev >= 10 and cur = 0)                       -- se frenó
       or (prev >= 30 and cur > 0 and cur <= prev * 0.6) -- cayó 40 % o más
       or (cur >= 50 and cur >= prev * 1.3)              -- creció 30 % o más
  ),

  -- Tiendas: dejaron de pedir o cayeron fuerte (14 días contra los 14 anteriores).
  st as (
    select account_id, store_id, max(store_name) as store_name,
      count(*) filter (where ordered_at >= now() - interval '14 days') as cur,
      count(*) filter (where ordered_at >= now() - interval '28 days' and ordered_at < now() - interval '14 days') as prev,
      count(*) filter (where ordered_at >= now() - interval '5 days') as last5,
      count(*) filter (where ordered_at >= now() - interval '35 days' and ordered_at < now() - interval '5 days') as base30,
      max(ordered_at) as last_order
    from o where store_name is not null group by 1, 2
  ),
  s_alerts as (
    select
      case when last5 = 0 then 'store_inactive' else 'store_drop' end as kind,
      case when last5 = 0 or prev >= 100 then 1 else 2 end as sev,
      account_id,
      jsonb_build_object('store', store_name, 'cur', cur, 'prev', prev, 'weekly', round(base30 / 30.0 * 7), 'last_order', last_order) as data,
      (case when last5 = 0 then base30 / 30.0 * 14 else prev - cur end)::numeric as score
    from st
    -- si toda la cuenta se frenó, basta la alerta de la cuenta
    where account_id not in (select account_id from a_alerts where kind = 'account_stalled')
      and ((last5 = 0 and base30 >= 30) or (prev >= 20 and last5 > 0 and cur <= prev * 0.65))
  ),

  -- Productos que crecen: 14 días contra los 14 anteriores, con volumen mínimo.
  pg as (
    select o.account_id, coalesce(i.product_external_id, i.product_name) as pkey,
      max(i.product_external_id) as pid, max(i.product_name) as sale_name,
      coalesce(sum(i.quantity) filter (where o.ordered_at >= now() - interval '14 days'), 0) as cur,
      coalesce(sum(i.quantity) filter (where o.ordered_at < now() - interval '14 days'), 0) as prev
    from o join public.order_items i on i.order_id = o.id
    where o.grp is distinct from 'cancelled' and o.ordered_at >= now() - interval '28 days'
    group by 1, 2
  ),
  p_alerts as (
    select 'product_growth' as kind, 3 as sev, pg.account_id,
      jsonb_build_object('product', coalesce(pr.name, pg.sale_name), 'cur', pg.cur, 'prev', pg.prev) as data,
      (pg.cur - pg.prev)::numeric as score
    from pg left join public.products pr on pr.account_id = pg.account_id and pr.external_id = pg.pid
    where pg.cur >= 30 and pg.cur >= pg.prev * 1.5
  ),

  -- Pedidos rechazados por falta de stock en los últimos 7 días, por producto.
  rj as (
    select distinct o.id, o.account_id
    from o join public.orders x on x.id = o.id,
      jsonb_array_elements(case when jsonb_typeof(x.raw->'orderRejections') = 'array'
                                then x.raw->'orderRejections' else '[]'::jsonb end) r
    where x.raw->'orderRejections' <> '[]'::jsonb
      and public.reject_category(r->>'rejectionReason') = 'stock'
      and (r->>'rejectedAt')::timestamptz >= now() - interval '7 days'
  ),
  r_alerts as (
    select 'stock_rejections' as kind, case when count(distinct rj.id) >= 20 then 1 else 2 end as sev, rj.account_id,
      jsonb_build_object('product', coalesce(max(pr.name), max(i.product_name)), 'orders', count(distinct rj.id)) as data,
      count(distinct rj.id)::numeric as score
    from rj
    join public.order_items i on i.order_id = rj.id
    left join public.products pr on pr.account_id = rj.account_id and pr.external_id = i.product_external_id
    group by rj.account_id, coalesce(i.product_external_id, i.product_name)
    having count(distinct rj.id) >= 5
  ),

  -- Pedidos estancados: en tránsito o con problemas sin cambiar de estado hace más de 5 días.
  k_alerts as (
    select 'stuck_orders' as kind, case when count(*) >= 50 then 1 else 2 end as sev, o.account_id,
      jsonb_build_object('orders', count(*),
        'transit', count(*) filter (where o.grp = 'transit'),
        'problem', count(*) filter (where o.grp = 'problem'),
        'amount', coalesce(sum(o.vendor_amount), 0)) as data,
      count(*)::numeric as score
    from o left join timeline t on t.id = o.id
    where o.grp in ('transit', 'problem')
      and coalesce(t.last_change, o.ordered_at) < now() - interval '5 days'
    group by o.account_id
    having count(*) >= 10
  ),

  -- Entrega baja por paquetera: pedidos ya cerrados de los últimos 60 días
  -- (sin la última semana, que aún no termina de cerrarse).
  closed as (
    select * from o
    where o.grp in ('delivered', 'failed')
      and o.ordered_at >= now() - interval '60 days' and o.ordered_at < now() - interval '7 days'
  ),
  acc_rate as (
    select account_id, count(*) filter (where grp = 'delivered')::numeric / count(*) as rate
    from closed group by 1
  ),
  cl as (
    select account_id, carrier,
      count(*) filter (where grp = 'delivered') as d, count(*) filter (where grp = 'failed') as f
    from closed where carrier is not null group by 1, 2
  ),
  c_alerts as (
    select 'carrier_delivery' as kind, 2 as sev, cl.account_id,
      jsonb_build_object('carrier', cl.carrier, 'rate', round(cl.d::numeric / (cl.d + cl.f), 3),
        'avg', round(ar.rate, 3), 'failed', cl.f, 'closed', cl.d + cl.f) as data,
      cl.f::numeric as score
    from cl join acc_rate ar using (account_id)
    where cl.d + cl.f >= 30
      and (cl.d::numeric / (cl.d + cl.f) < ar.rate - 0.08 or cl.d::numeric / (cl.d + cl.f) < 0.65)
  ),

  -- Entrega baja por producto (contra el promedio de su cuenta).
  pl as (
    select c.account_id, coalesce(i.product_external_id, i.product_name) as pkey,
      max(i.product_external_id) as pid, max(i.product_name) as sale_name,
      count(distinct c.id) filter (where c.grp = 'delivered') as d,
      count(distinct c.id) filter (where c.grp = 'failed') as f
    from closed c join public.order_items i on i.order_id = c.id
    group by 1, 2
  ),
  pl_alerts as (
    select 'product_delivery' as kind, 3 as sev, pl.account_id,
      jsonb_build_object('product', coalesce(pr.name, pl.sale_name), 'rate', round(pl.d::numeric / (pl.d + pl.f), 3),
        'avg', round(ar.rate, 3), 'failed', pl.f, 'closed', pl.d + pl.f) as data,
      pl.f::numeric as score
    from pl join acc_rate ar using (account_id)
    left join public.products pr on pr.account_id = pl.account_id and pr.external_id = pl.pid
    where pl.d + pl.f >= 30 and pl.d::numeric / (pl.d + pl.f) < ar.rate - 0.12
  ),

  -- Entregados hace más de 3 días que la plataforma aún no liquida.
  u_alerts as (
    select 'unpaid_late' as kind, 2 as sev, o.account_id,
      jsonb_build_object('orders', count(*), 'amount', coalesce(sum(o.vendor_amount), 0)) as data,
      count(*)::numeric as score
    from o left join timeline t on t.id = o.id
    where o.grp = 'delivered' and not coalesce(o.paid, false)
      and coalesce(t.delivered_at, o.ordered_at) < now() - interval '3 days'
    group by o.account_id
    having count(*) >= 5
  ),

  all_alerts as (
    select * from a_alerts union all select * from s_alerts union all select * from p_alerts
    union all select * from r_alerts union all select * from k_alerts union all select * from c_alerts
    union all select * from pl_alerts union all select * from u_alerts
  ),
  -- como máximo 3 por tipo, para que un solo tipo no llene el bloque
  capped as (
    select al.*, row_number() over (partition by kind order by sev, score desc) as rn
    from all_alerts al
  ),
  -- hasta 8 problemas (rojo y naranja) y el resto oportunidades, con al menos 2 lugares para ellas
  problems as (
    select * from capped where rn <= 3 and sev < 3 order by sev, score desc limit 8
  ),
  chances as (
    select * from capped where rn <= 3 and sev = 3 order by score desc
    limit 10 - (select count(*) from problems)
  ),
  ranked as (
    select c.kind, c.sev, c.account_id, a.name as account_name, a.country, a.currency, c.data, c.score
    from (select * from problems union all select * from chances) c
    join public.accounts a on a.id = c.account_id
  )
  select jsonb_build_object(
    'total', (select count(*) from capped where rn <= 3),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', kind, 'severity', sev, 'account_id', account_id, 'account', account_name,
        'country', country, 'currency', currency, 'data', data
      ) order by sev, score desc) from ranked), '[]'::jsonb)
  )
$$;

revoke all on function public.owner_alerts(uuid) from public, anon, authenticated;
grant execute on function public.owner_alerts(uuid) to service_role;
