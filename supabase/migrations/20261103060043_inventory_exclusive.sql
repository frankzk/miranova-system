-- Inventario con lo privatizado: Drop muestra en el catálogo solo el stock público, pero cada
-- movimiento de inventario dice si es del stock general (scope GENERAL) o del exclusivo de una
-- tienda (scope EXCLUSIVE, con seller y newQty = saldo exclusivo de esa tienda después del
-- movimiento). El saldo exclusivo de cada tienda es el newQty de su último movimiento exclusivo
-- (por variante, si el producto las tiene).
--   stock:             total = público + privatizado (lo que hay en bodega)
--   public_stock:      disponible para todas las tiendas (catálogo)
--   exclusive:         privatizado, sumando las tiendas
--   exclusive_stores:  [{ seller_id, name, units, out14 (lo que esa tienda despachó en 14 días), at }]
--   exclusive_unknown: tiendas que Drop marca con el producto privatizado y sin movimientos guardados
-- Lo demás, igual que en 0018_inventory_status.sql.
create or replace function public.inventory_status(p_account uuid)
returns jsonb language sql stable as $$
  with a as (
    select id, name, currency, timezone, (now() at time zone timezone)::date as today
    from public.accounts where (p_account is null or id = p_account)
  ),
  m as (
    select s.account_id, s.product_external_id, s.units, s.reason, s.occurred_at,
      (s.occurred_at at time zone a.timezone)::date as d, a.today
    from public.stock_movements s join a on a.id = s.account_id
    where s.occurred_at >= now() - interval '120 days'
  ),
  agg as (
    select account_id, product_external_id,
      coalesce(-sum(units) filter (where reason in ('ORDER_DISPATCH', 'DISPATCH') and occurred_at >= now() - interval '14 days'), 0) as out14,
      coalesce(sum(units) filter (where reason = 'ORDER_RETURN' and occurred_at >= now() - interval '14 days'), 0) as ret14,
      coalesce(-sum(units) filter (where reason in ('ORDER_DISPATCH', 'DISPATCH') and occurred_at >= now() - interval '30 days'), 0) as out30,
      coalesce(sum(units) filter (where reason = 'ORDER_RETURN' and occurred_at >= now() - interval '30 days'), 0) as ret30,
      max(occurred_at) filter (where reason in ('ORDER_DISPATCH', 'DISPATCH')) as last_out_at,
      min(occurred_at) as first_at
    from m group by 1, 2
  ),
  rs as (
    select account_id, product_external_id,
      jsonb_agg(jsonb_build_object('at', occurred_at, 'units', units, 'reason', reason) order by occurred_at desc) filter (where rn <= 5) as restocks,
      max(occurred_at) as last_restock_at
    from (
      select account_id, product_external_id, occurred_at, units, reason,
        row_number() over (partition by account_id, product_external_id order by occurred_at desc) as rn
      from public.stock_movements
      where units > 0 and reason in ('STOCK_REQUEST', 'INITIAL_STOCK', 'MANUAL')
        and (p_account is null or account_id = p_account)
    ) x group by 1, 2
  ),
  -- salida neta por día (30 días) para la mini gráfica
  dd as (
    select account_id, product_external_id, d,
      -sum(units) filter (where reason in ('ORDER_DISPATCH', 'DISPATCH', 'ORDER_RETURN')) as net
    from m where d > today - 30 group by 1, 2, 3
  ),
  -- pedidos por despachar que llevan el producto
  pend as (
    select o.account_id, i.product_external_id, count(distinct o.id) as n
    from public.orders o join public.order_items i on i.order_id = o.id
    where public.status_group(o.status_code) = 'dispatch' and o.ordered_at >= now() - interval '30 days'
      and (p_account is null or o.account_id = p_account) and i.product_external_id is not null
    group by 1, 2
  ),
  -- movimientos del stock exclusivo (privatizado a una tienda)
  xmov as (
    select s.account_id, s.product_external_id, s.raw->'seller'->>'id' as seller_id,
      coalesce(s.raw->'variant'->>'id', s.raw->>'variant', '') as variant,
      s.balance, s.units, s.reason, s.occurred_at, s.number
    from public.stock_movements s
    where s.raw->>'scope' = 'EXCLUSIVE' and s.raw->'seller'->>'id' is not null
      and (p_account is null or s.account_id = p_account)
  ),
  -- saldo de cada tienda (y variante): el de su último movimiento exclusivo
  xlast as (
    select distinct on (account_id, product_external_id, seller_id, variant)
      account_id, product_external_id, seller_id, variant, greatest(coalesce(balance, 0), 0) as units, occurred_at
    from xmov
    order by account_id, product_external_id, seller_id, variant, occurred_at desc, number desc nulls last
  ),
  -- nombre de la tienda: el último que mandó Drop en cualquier movimiento de la cuenta
  xname as (
    select distinct on (s.account_id, s.raw->'seller'->>'id') s.account_id, s.raw->'seller'->>'id' as seller_id, s.raw->'seller'->>'name' as name
    from public.stock_movements s
    where s.raw->'seller'->>'name' is not null and (p_account is null or s.account_id = p_account)
    order by s.account_id, s.raw->'seller'->>'id', s.occurred_at desc
  ),
  xout as (
    select account_id, product_external_id, seller_id, coalesce(-sum(units), 0) as out14
    from xmov where reason in ('ORDER_DISPATCH', 'DISPATCH') and occurred_at >= now() - interval '14 days'
    group by 1, 2, 3
  ),
  xseller as (
    select l.account_id, l.product_external_id, l.seller_id, sum(l.units) as units, max(l.occurred_at) as at
    from xlast l group by 1, 2, 3
  ),
  ex as (
    select x.account_id, x.product_external_id, sum(x.units) as total,
      coalesce(jsonb_agg(jsonb_build_object('seller_id', x.seller_id, 'name', n.name, 'units', x.units, 'out14', coalesce(o.out14, 0), 'at', x.at)
        order by x.units desc) filter (where x.units > 0), '[]'::jsonb) as stores,
      array_agg(x.seller_id) as known
    from xseller x
    left join xname n on n.account_id = x.account_id and n.seller_id = x.seller_id
    left join xout o on o.account_id = x.account_id and o.product_external_id = x.product_external_id and o.seller_id = x.seller_id
    group by 1, 2
  )
  select coalesce(jsonb_agg(row_to_json(r) order by r.out14 desc, r.name), '[]'::jsonb) from (
    select p.account_id, a.name as account_name, p.external_id, p.code, p.name, p.status, p.image_url,
      coalesce(p.stock, 0) + coalesce(ex.total, 0) as stock,
      coalesce(p.stock, 0) as public_stock,
      coalesce(ex.total, 0) as exclusive,
      coalesce(ex.stores, '[]'::jsonb) as exclusive_stores,
      (select coalesce(jsonb_agg(sid), '[]'::jsonb)
         from jsonb_array_elements_text(case when jsonb_typeof(p.raw->'exclusiveSellerIds') = 'array' then p.raw->'exclusiveSellerIds' else '[]'::jsonb end) sid
        where not (sid = any(coalesce(ex.known, '{}'::text[])))) as exclusive_unknown,
      p.variants_count,
      coalesce(g.out14, 0) as out14, coalesce(g.ret14, 0) as ret14,
      coalesce(g.out30, 0) as out30, coalesce(g.ret30, 0) as ret30,
      g.last_out_at, g.first_at, rs.last_restock_at, coalesce(rs.restocks, '[]'::jsonb) as restocks,
      coalesce(pd.n, 0) as pending_orders,
      (select jsonb_agg(coalesce(x.net, 0) order by gs)
         from generate_series(a.today - 29, a.today, interval '1 day') gs
         left join dd x on x.account_id = p.account_id and x.product_external_id = p.external_id and x.d = gs::date) as daily
    from public.products p
    join a on a.id = p.account_id
    left join agg g on g.account_id = p.account_id and g.product_external_id = p.external_id
    left join rs on rs.account_id = p.account_id and rs.product_external_id = p.external_id
    left join pend pd on pd.account_id = p.account_id and pd.product_external_id = p.external_id
    left join ex on ex.account_id = p.account_id and ex.product_external_id = p.external_id
    -- solo productos con algo que decir: con existencia (pública o privatizada), con movimiento reciente o con pedidos esperando
    where coalesce(p.stock, 0) > 0 or coalesce(ex.total, 0) > 0 or g.out30 > 0 or pd.n > 0
  ) r
$$;

revoke all on function public.inventory_status(uuid) from public, anon, authenticated;
grant execute on function public.inventory_status(uuid) to service_role;
