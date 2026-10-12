-- La tienda de cada pedido como columna propia (antes cada consulta la sacaba del `raw` de Drop,
-- descomprimiéndolo pedido por pedido) y las cifras de cada tienda en un período elegido.

alter table public.orders add column if not exists store_id text
  generated always as (coalesce(raw->'seller'->>'sellerId', raw->'user'->>'id', 'name:' || dropshipper)) stored;
create index if not exists orders_store_idx on public.orders (account_id, store_id, ordered_at desc);

-- Salud de tiendas con un período elegido: pedidos del período y del período anterior del mismo
-- largo, días con pedidos y promedios del período. Sin cancelados, como store_health.
create or replace function public.store_period(
  p_account uuid, p_from timestamptz, p_to timestamptz, p_prev_from timestamptz, p_prev_to timestamptz
) returns jsonb
language sql stable
as $$
  with base as (
    select o.id, o.account_id, a.name account_name, coalesce(o.currency, a.currency) currency, o.dropshipper, o.store_id,
      o.ordered_at, (o.ordered_at at time zone a.timezone)::date d, o.total, o.vendor_amount,
      o.ordered_at >= p_from cur
    from public.orders o join public.accounts a on a.id = o.account_id
    where o.dropshipper is not null
      and ((o.ordered_at >= p_from and o.ordered_at <= p_to) or (o.ordered_at >= p_prev_from and o.ordered_at <= p_prev_to))
      and (p_account is null or o.account_id = p_account)
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  units as (
    select i.order_id, sum(i.quantity) u
    from public.order_items i join base b on b.id = i.order_id
    where b.cur
    group by 1
  ),
  prod as (
    select b.account_id, b.store_id, coalesce(i.product_external_id, 'name:' || i.product_name) pk,
      (array_agg(i.product_name order by b.ordered_at desc))[1] pname, count(distinct b.id) n
    from base b join public.order_items i on i.order_id = b.id
    where b.cur
    group by 1, 2, 3
  ),
  top as (
    select distinct on (account_id, store_id) account_id, store_id, pname, n,
      count(*) over (partition by account_id, store_id) skus
    from prod order by account_id, store_id, n desc, pname
  )
  select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) from (
    select b.account_id, b.store_id, max(b.account_name) account_name, max(b.currency) currency,
      (array_agg(b.dropshipper order by b.ordered_at desc))[1] name,
      count(*) filter (where b.cur) orders,
      count(*) filter (where not b.cur) prev,
      count(distinct b.d) filter (where b.cur) active,
      round(avg(b.total) filter (where b.cur), 2) ticket,
      round(avg(b.vendor_amount) filter (where b.cur), 2) vendor_per_order,
      round(avg(u.u), 2) units_per_order,
      coalesce(max(tp.skus), 0) skus,
      max(tp.pname) top_product,
      round(max(tp.n)::numeric / nullif(count(*) filter (where b.cur), 0), 3) top_share,
      -- última venta (para las tiendas que no salen en Salud por no vender en 60 días)
      (select max(o2.ordered_at) from public.orders o2
        where o2.account_id = b.account_id and o2.store_id = b.store_id and o2.dropshipper is not null
          and public.status_group(o2.status_code) is distinct from 'cancelled') last_at
    from base b left join units u on u.order_id = b.id
      left join top tp on tp.account_id = b.account_id and tp.store_id = b.store_id
    group by b.account_id, b.store_id
  ) s
$$;

revoke all on function public.store_period(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.store_period(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to service_role;
