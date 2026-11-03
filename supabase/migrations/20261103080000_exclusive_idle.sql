-- Privatizado sin pautar: una fila por cuenta, tienda y producto que la tienda tiene privatizado
-- (stock exclusivo con saldo > 0). Solo hechos; la clasificación (al día / dejó de pautar /
-- durmiendo) vive en lib/exclusive-idle.ts para poder probarla.
--   units:           saldo privatizado (último movimiento EXCLUSIVE de cada variante, como inventory_status)
--   since/held_days: desde cuándo lo tiene apartado sin que el saldo vuelva a 0 (un 0 de menos de un
--                    día no cuenta: al ajustar una solicitud Drop libera y vuelve a apartar en segundos)
--   since_known:     ese inicio es la reserva desde 0 que mandó Drop. Si no la tenemos guardada (el
--                    historial tiene huecos) since es solo lo más antiguo que vemos de ese apartado
--   dispatched_since: salidas de ese stock (pedidos despachados) desde ese inicio
--   last_at/last_day/days_since: su último pedido (no cancelado) de ese producto y días desde ese día local
--   orders_since:    pedidos de ese producto hechos desde ese inicio
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
      greatest(coalesce(s.balance, 0), 0) as balance,
      -- saldo antes del movimiento según Drop: no depende de tener guardado el movimiento anterior
      case when jsonb_typeof(s.raw->'previousQty') = 'number' then greatest((s.raw->>'previousQty')::numeric, 0) end as prev_qty,
      s.occurred_at, s.number, s.external_id, s.reason
    from public.stock_movements s join a on a.id = s.account_id
    where s.raw->>'scope' = 'EXCLUSIVE' and s.raw->'seller'->>'id' is not null
  ),
  -- movimiento anterior guardado de la misma variante (con la misma hora, el id de Drop da el orden)
  xseq as (
    select x.*,
      lag(balance) over w as prev_balance,
      lag(occurred_at) over w as prev_at,
      row_number() over (partition by account_id, product_external_id, seller_id, variant
        order by occurred_at desc, number desc nulls last, external_id desc) as rn
    from xmov x
    window w as (partition by account_id, product_external_id, seller_id, variant order by occurred_at, number nulls first, external_id)
  ),
  -- empieza a tenerlo apartado al pasar de 0 a algo (según Drop, o porque lo último guardado era 0 y
  -- falta el movimiento que lo apartó), salvo que haya estado en 0 menos de un día
  xstart as (
    select x.*,
      balance > 0 and (coalesce(prev_qty, 0) = 0 or coalesce(prev_balance, 0) = 0)
        and (prev_at is null or occurred_at - prev_at >= interval '1 day') as is_start
    from xseq x
  ),
  -- inicio del apartado actual de cada variante: el último inicio (sin uno claro, el primer movimiento
  -- guardado con saldo) y si ese inicio es la reserva desde 0 que mandó Drop (si no, no lo sabemos)
  xhold as (
    select x.*,
      coalesce(max(occurred_at) filter (where is_start) over v, min(occurred_at) filter (where balance > 0) over v) as hold_since,
      coalesce((array_agg(coalesce(prev_qty, 0) = 0) filter (where is_start)
        over (v order by occurred_at desc, external_id desc rows between unbounded preceding and unbounded following))[1], false) as hold_known
    from xstart x
    window v as (partition by account_id, product_external_id, seller_id, variant)
  ),
  -- por variante: saldo actual (último movimiento), inicio del apartado y salidas de ese stock desde entonces
  xvar as (
    select account_id, product_external_id, seller_id, variant,
      max(balance) filter (where rn = 1) as units,
      min(hold_since) as since,
      bool_and(hold_known) as since_known,
      count(*) filter (where reason = 'DISPATCH' and occurred_at >= hold_since) as dispatched
    from xhold group by 1, 2, 3, 4
  ),
  held as (
    select account_id, product_external_id, seller_id, sum(units)::int as units,
      min(since) filter (where units > 0) as since,
      coalesce(bool_and(since_known) filter (where units > 0), false) as since_known,
      coalesce(sum(dispatched) filter (where units > 0), 0)::int as dispatched_since
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
  -- pedidos (no cancelados) de ese producto hechos por esa tienda, con su día local: 6 meses o, si lo
  -- tiene apartado desde antes, desde entonces (para contar bien los pedidos desde que lo privatizó)
  po as (
    select h.account_id, h.product_external_id, h.seller_id, o.id, o.ordered_at, (o.ordered_at at time zone a.timezone)::date as d
    from held h
    join a on a.id = h.account_id
    join public.orders o on o.account_id = h.account_id and o.store_id = h.seller_id
      and o.ordered_at >= least(h.since, now() - interval '180 days')
    join public.order_items i on i.order_id = o.id and i.product_external_id = h.product_external_id
    where public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  pagg as (
    select p.account_id, p.product_external_id, p.seller_id,
      max(p.d) as last_day, max(p.ordered_at) as last_at,
      count(distinct p.id) filter (where p.ordered_at >= h.since) as orders_since,
      count(distinct p.id) filter (where p.d > a.today - 7) as n7,
      -- ritmo que llevaba: pedidos y días con pedidos en los 14 / 7 días que terminan en su último pedido
      count(distinct p.id) filter (where p.d > p.lday - 14) as n14_before,
      count(distinct p.d) filter (where p.d > p.lday - 7) as active_before
    from (select po.*, max(po.d) over (partition by po.account_id, po.product_external_id, po.seller_id) as lday from po) p
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
      h.units, h.since, a.today - (h.since at time zone a.timezone)::date as held_days, h.since_known, h.dispatched_since,
      g.last_at, g.last_day, a.today - g.last_day as days_since,
      coalesce(g.orders_since, 0) as orders_since, coalesce(g.n7, 0) as n7,
      coalesce(g.n14_before, 0) as n14_before, coalesce(g.active_before, 0) as active_before,
      so.last_at as store_last_at, a.today - (so.last_at at time zone a.timezone)::date as store_days_since,
      pr.movements_sync_at
    from held h
    join a on a.id = h.account_id
    left join xname n on n.account_id = h.account_id and n.seller_id = h.seller_id
    left join pagg g on g.account_id = h.account_id and g.product_external_id = h.product_external_id and g.seller_id = h.seller_id
    left join so on so.account_id = h.account_id and so.seller_id = h.seller_id
    left join public.products pr on pr.account_id = h.account_id and pr.external_id = h.product_external_id
  ) r
$$;

revoke all on function public.exclusive_idle(uuid) from public, anon, authenticated;
grant execute on function public.exclusive_idle(uuid) to service_role;
