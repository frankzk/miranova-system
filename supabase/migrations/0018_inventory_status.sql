-- Inventario por producto, a partir de los movimientos de Drop (stock_movements) y el catálogo.
--   stock: existencia actual del catálogo (suma de variantes)
--   out14/ret14: unidades que salieron por pedido / volvieron por devolución en 14 días (lo mismo en 30)
--   daily: salida neta por día de los últimos 30 días (salidas − devoluciones), para la mini gráfica
--   restocks: últimas reposiciones (STOCK_REQUEST, INITIAL_STOCK y ajustes manuales de entrada)
--   pending: pedidos por despachar que llevan el producto (para "agotado con pedidos esperando")
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
  )
  select coalesce(jsonb_agg(row_to_json(r) order by r.out14 desc, r.name), '[]'::jsonb) from (
    select p.account_id, a.name as account_name, p.external_id, p.code, p.name, p.status, p.image_url,
      coalesce(p.stock, 0) as stock, p.variants_count,
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
    -- solo productos con algo que decir: con existencia, con movimiento reciente o con pedidos esperando
    where coalesce(p.stock, 0) > 0 or g.out30 > 0 or pd.n > 0
  ) r
$$;

revoke all on function public.inventory_status(uuid) from public, anon, authenticated;
grant execute on function public.inventory_status(uuid) to service_role;
