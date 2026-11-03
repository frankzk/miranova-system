-- Privatizado sin pautar: una fila por cuenta, tienda y producto que la tienda tiene privatizado
-- (stock exclusivo con saldo > 0). Solo hechos; la clasificación (al día / dejó de pautar /
-- durmiendo) vive en lib/exclusive-idle.ts para poder probarla.
--   units:           saldo privatizado (último movimiento EXCLUSIVE de cada variante, como inventory_status)
--   since/held_days: desde cuándo lo tiene apartado sin que el saldo vuelva a 0
--   last_at/last_day/days_since: su último pedido (no cancelado) de ese producto y días desde ese día local
--   orders_since:    pedidos de ese producto desde que lo privatizó (0 = no lo estrenó)
--   n7:              pedidos de ese producto en los últimos 7 días (con hoy)
--   n14_before/active_before: pedidos en los 14 días y días con pedidos en los 7 días que terminan en su
--                    último pedido (el ritmo que llevaba antes de frenarse)
--   store_last_at/store_days_since: último pedido de la tienda con cualquier producto
-- Los pedidos se buscan por orders.store_id (= seller.id de los movimientos) y order_items.product_external_id.
create or replace function public.exclusive_idle(p_account uuid)
returns jsonb language sql stable as $$
  with a as (
    select id, name, timezone, (now() at time zone timezone)::date as today
    from public.accounts where p_account is null or id = p_account
  ),
  -- movimientos del stock exclusivo (igual que inventory_status)
  xmov as (
    select s.account_id, s.product_external_id, s.raw->'seller'->>'id' as seller_id,
      coalesce(s.raw->'variant'->>'id', s.raw->>'variant', '') as variant,
      greatest(coalesce(s.balance, 0), 0) as balance, s.occurred_at, s.number
    from public.stock_movements s join a on a.id = s.account_id
    where s.raw->>'scope' = 'EXCLUSIVE' and s.raw->'seller'->>'id' is not null
  ),
  -- saldo anterior de cada movimiento: pasar de 0 a algo es empezar a tenerlo apartado
  xseq as (
    select x.*,
      lag(balance) over (partition by account_id, product_external_id, seller_id, variant order by occurred_at, number nulls first) as prev_balance,
      row_number() over (partition by account_id, product_external_id, seller_id, variant order by occurred_at desc, number desc nulls last) as rn
    from xmov x
  ),
  -- por variante: saldo actual (último movimiento) y desde cuándo lo tiene apartado sin volver a 0
  xvar as (
    select account_id, product_external_id, seller_id, variant,
      max(balance) filter (where rn = 1) as units,
      max(occurred_at) filter (where balance > 0 and coalesce(prev_balance, 0) = 0) as since
    from xseq group by 1, 2, 3, 4
  ),
  held as (
    select account_id, product_external_id, seller_id, sum(units)::int as units, min(since) filter (where units > 0) as since
    from xvar group by 1, 2, 3
    having sum(units) > 0
  ),
  -- nombre de la tienda: el último que mandó Drop en un movimiento de la cuenta
  xname as (
    select distinct on (s.account_id, s.raw->'seller'->>'id') s.account_id, s.raw->'seller'->>'id' as seller_id, s.raw->'seller'->>'name' as name
    from public.stock_movements s join a on a.id = s.account_id
    where s.raw->'seller'->>'name' is not null
    order by s.account_id, s.raw->'seller'->>'id', s.occurred_at desc
  ),
  -- pedidos (no cancelados) de ese producto hechos por esa tienda, con su día local
  po as (
    select h.account_id, h.product_external_id, h.seller_id, o.id, o.ordered_at, (o.ordered_at at time zone a.timezone)::date as d
    from held h
    join a on a.id = h.account_id
    join public.orders o on o.account_id = h.account_id and o.store_id = h.seller_id and o.ordered_at >= now() - interval '180 days'
    join public.order_items i on i.order_id = o.id and i.product_external_id = h.product_external_id
    where public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  pl as (
    select account_id, product_external_id, seller_id, max(d) as last_day, max(ordered_at) as last_at
    from po group by 1, 2, 3
  ),
  pagg as (
    select p.account_id, p.product_external_id, p.seller_id,
      count(distinct p.id) filter (where p.ordered_at >= h.since) as orders_since,
      count(distinct p.id) filter (where p.d > a.today - 7) as n7,
      -- ritmo que llevaba: pedidos y días con pedidos en los 14 / 7 días que terminan en su último pedido
      count(distinct p.id) filter (where p.d > l.last_day - 14) as n14_before,
      count(distinct p.d) filter (where p.d > l.last_day - 7) as active_before
    from po p
    join pl l using (account_id, product_external_id, seller_id)
    join held h using (account_id, product_external_id, seller_id)
    join a on a.id = p.account_id
    group by 1, 2, 3
  ),
  -- la tienda en general: su último pedido (de cualquier producto) y su nombre en los pedidos
  so as (
    select o.account_id, o.store_id as seller_id, max(o.ordered_at) as last_at,
      (array_agg(o.dropshipper order by o.ordered_at desc) filter (where o.dropshipper is not null))[1] as dropshipper
    from public.orders o
    join (select distinct account_id, seller_id from held) hs on hs.account_id = o.account_id and hs.seller_id = o.store_id
    where o.ordered_at >= now() - interval '180 days' and public.status_group(o.status_code) is distinct from 'cancelled'
    group by 1, 2
  )
  select coalesce(jsonb_agg(row_to_json(r) order by r.account_name, r.store_name, r.units desc), '[]'::jsonb) from (
    select h.account_id, a.name as account_name, a.today,
      h.seller_id as store_id, coalesce(so.dropshipper, n.name, h.seller_id) as store_name,
      h.product_external_id, coalesce(pr.name, h.product_external_id) as product_name, pr.code as product_code,
      h.units, h.since, a.today - (h.since at time zone a.timezone)::date as held_days,
      l.last_at, l.last_day, a.today - l.last_day as days_since,
      coalesce(g.orders_since, 0) as orders_since, coalesce(g.n7, 0) as n7,
      coalesce(g.n14_before, 0) as n14_before, coalesce(g.active_before, 0) as active_before,
      so.last_at as store_last_at, a.today - (so.last_at at time zone a.timezone)::date as store_days_since,
      pr.movements_sync_at
    from held h
    join a on a.id = h.account_id
    left join xname n on n.account_id = h.account_id and n.seller_id = h.seller_id
    left join pl l on l.account_id = h.account_id and l.product_external_id = h.product_external_id and l.seller_id = h.seller_id
    left join pagg g on g.account_id = h.account_id and g.product_external_id = h.product_external_id and g.seller_id = h.seller_id
    left join so on so.account_id = h.account_id and so.seller_id = h.seller_id
    left join public.products pr on pr.account_id = h.account_id and pr.external_id = h.product_external_id
  ) r
$$;

revoke all on function public.exclusive_idle(uuid) from public, anon, authenticated;
grant execute on function public.exclusive_idle(uuid) to service_role;
