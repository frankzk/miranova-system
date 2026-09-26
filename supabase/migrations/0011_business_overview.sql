-- Resumen Miranova: cuántas tiendas realmente mueven pedidos y cómo evoluciona la base.
-- Tienda = cuenta + ID del vendedor en la plataforma (como order_facts). Sin canceladas/rechazadas,
-- salvo "registradas", que cuenta toda tienda que alguna vez hizo un pedido.
--   activas 30d / 7d / hoy-ayer: con al menos un pedido en la ventana (hoy/ayer en la zona de la cuenta)
--   nuevas del mes: su primer pedido cae en el mes en curso (zona de la cuenta)
--   reactivadas: volvieron a pedir en los últimos 30 días tras 30+ días sin pedidos
--   dejaron de vender: 3+ pedidos entre hace 44 y 14 días y ninguno en los últimos 14
--   weeks: 12 semanas móviles (0 = últimos 7 días) con tiendas activas, nuevas y pedidos
create or replace function public.business_overview(p_account uuid)
returns jsonb language sql stable as $$
  with o as (
    select o.id, o.account_id, a.name as account_name, coalesce(o.currency, a.currency) as currency,
      o.ordered_at, o.total, o.dropshipper,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
      (o.ordered_at at time zone a.timezone)::date as d,
      (now() at time zone a.timezone)::date as today,
      public.status_group(o.status_code) is not distinct from 'cancelled' as cancelled
    from public.orders o join public.accounts a on a.id = o.account_id
    where o.dropshipper is not null and (p_account is null or o.account_id = p_account)
  ),
  ok as (select * from o where not cancelled),
  st as (
    select account_id, store_id, max(account_name) as account_name,
      (array_agg(dropshipper order by ordered_at desc))[1] as name,
      min(ordered_at) as first_at, max(ordered_at) as last_at,
      min(d) as first_d, max(today) as today,
      count(*) filter (where ordered_at >= now() - interval '30 days') as n30,
      count(*) filter (where ordered_at >= now() - interval '7 days') as n7,
      count(*) filter (where d >= today - 1) as n2d,
      count(*) filter (where ordered_at >= now() - interval '14 days') as n14,
      count(*) filter (where ordered_at >= now() - interval '44 days' and ordered_at < now() - interval '14 days') as n_before
    from ok group by 1, 2
  ),
  back as (
    select account_id, store_id, max(ordered_at - prev_at) as gap
    from (
      select account_id, store_id, ordered_at,
        lag(ordered_at) over (partition by account_id, store_id order by ordered_at) as prev_at
      from ok
    ) x
    where ordered_at >= now() - interval '30 days' and prev_at is not null and ordered_at - prev_at >= interval '30 days'
    group by 1, 2
  ),
  units as (
    select i.order_id, sum(i.quantity) as u
    from public.order_items i join ok on ok.id = i.order_id
    where ok.ordered_at >= now() - interval '30 days'
    group by 1
  ),
  wk as (
    select k,
      (select count(distinct (account_id, store_id)) from ok
        where ordered_at >= now() - (k + 1) * interval '7 days' and ordered_at < now() - k * interval '7 days') as active,
      (select count(*) from st
        where first_at >= now() - (k + 1) * interval '7 days' and first_at < now() - k * interval '7 days') as new,
      (select count(*) from ok
        where ordered_at >= now() - (k + 1) * interval '7 days' and ordered_at < now() - k * interval '7 days') as orders
    from generate_series(0, 11) k
  ),
  lst as (
    select 'new' as kind, account_id, store_id, account_name, name, n30 as orders, first_at as at from st
      where date_trunc('month', first_d) = date_trunc('month', today)
    union all
    select 'reactivated', st.account_id, st.store_id, account_name, name, n30, last_at from st
      join back using (account_id, store_id)
    union all
    select 'stopped', account_id, store_id, account_name, name, n_before, last_at from st
      where n14 = 0 and n_before >= 3
  )
  select jsonb_build_object(
    'orders_today', (select count(*) from ok where d = today),
    'orders_7d', (select count(*) from ok where ordered_at >= now() - interval '7 days'),
    'orders_prev7', (select count(*) from ok where ordered_at >= now() - interval '14 days' and ordered_at < now() - interval '7 days'),
    'orders_30d', (select count(*) from ok where ordered_at >= now() - interval '30 days'),
    'units_per_order', (select round(avg(u), 2) from units),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('currency', currency, 'ticket', ticket, 'orders', n) order by n desc)
      from (select currency, round(avg(total), 2) as ticket, count(*) as n from ok
            where ordered_at >= now() - interval '30 days' group by 1) t), '[]'::jsonb),
    'stores', jsonb_build_object(
      'registered', (select count(distinct (account_id, store_id)) from o),
      'active30', (select count(*) from st where n30 > 0),
      'active7', (select count(*) from st where n7 > 0),
      'active2d', (select count(*) from st where n2d > 0),
      'new_month', (select count(*) from lst where kind = 'new'),
      'reactivated', (select count(*) from lst where kind = 'reactivated'),
      'stopped', (select count(*) from lst where kind = 'stopped')
    ),
    'weeks', (select jsonb_agg(jsonb_build_object('k', k, 'active', active, 'new', new, 'orders', orders) order by k desc) from wk),
    'lists', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'account_id', account_id, 'store_id', store_id,
      'account_name', account_name, 'name', name, 'orders', orders, 'at', at) order by kind, orders desc) from lst), '[]'::jsonb)
  )
$$;

revoke all on function public.business_overview(uuid) from public, anon, authenticated;
grant execute on function public.business_overview(uuid) to service_role;
