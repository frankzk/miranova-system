-- Matriz tienda × producto: pedidos de cada tienda en cada producto, en el período elegido
-- (p_days: 7, 30 o 90 días hacia atrás desde ahora) y en 90 días (base para la venta cruzada:
-- "qué productos nunca probó una tienda"). Misma identidad de tienda y producto que line_facts,
-- leída de order_items para no parsear el JSON de cada línea. Sin canceladas/rechazadas.
-- Devuelve todo (sin recortar): la página elige las tiendas y productos principales.
--   cells:    { account_id, store_id, product_key, n (período), n90 } solo pares con pedidos en 90 días
--   stores:   { account_id, store_id, name, orders, orders90, skus } (orders = pedidos distintos)
--   products: { account_id, product_key, name, orders, orders90, stores90 }
create or replace function public.store_product_matrix(p_account uuid, p_days int)
returns jsonb language sql stable as $$
  with lines as (
    select o.id order_id, o.account_id, o.ordered_at, o.dropshipper,
      o.ordered_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 90)) in_period,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) store_id,
      coalesce(i.product_external_id, 'sku:' || i.sku) product_key, i.product_external_id, i.product_name
    from public.orders o
    join public.order_items i on i.order_id = o.id
    where o.ordered_at >= now() - interval '90 days'
      and o.dropshipper is not null
      and (p_account is null or o.account_id = p_account)
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  -- un pedido por tienda y producto
  sp as (
    select account_id, store_id, product_key, order_id, bool_or(in_period) in_period
    from lines where product_key is not null group by 1, 2, 3, 4
  ),
  cells as (
    select account_id, store_id, product_key, count(*) filter (where in_period) n, count(*) n90
    from sp group by 1, 2, 3
  ),
  stores as (
    select account_id, store_id, (array_agg(dropshipper order by ordered_at desc))[1] name,
      count(distinct order_id) filter (where in_period) orders, count(distinct order_id) orders90,
      count(distinct product_key) filter (where in_period) skus
    from lines group by 1, 2
  ),
  products as (
    select l.account_id, l.product_key,
      coalesce(max(pr.name), (array_agg(l.product_name order by l.ordered_at desc))[1]) name,
      count(distinct l.order_id) filter (where l.in_period) orders, count(distinct l.order_id) orders90,
      count(distinct l.store_id) stores90
    from lines l
    left join public.products pr on pr.account_id = l.account_id and pr.external_id = l.product_external_id
    where l.product_key is not null
    group by 1, 2
  )
  select jsonb_build_object(
    'days', least(greatest(coalesce(p_days, 30), 1), 90),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('account_id', a.id, 'account_name', a.name, 'currency', a.currency) order by a.name)
                          from public.accounts a where a.id in (select account_id from stores)), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(to_jsonb(s) order by s.orders desc, s.orders90 desc) from stores s), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p) order by p.orders desc, p.orders90 desc) from products p), '[]'::jsonb),
    'cells', coalesce((select jsonb_agg(to_jsonb(c)) from cells c), '[]'::jsonb)
  )
$$;

revoke all on function public.store_product_matrix(uuid, int) from public, anon, authenticated;
grant execute on function public.store_product_matrix(uuid, int) to service_role;
