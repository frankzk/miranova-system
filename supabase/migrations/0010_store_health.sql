-- Salud de tiendas: una fila por tienda (ID del vendedor en la plataforma, igual que 0008_facts_views) y cuenta,
-- con ritmo de ventas, constancia y ticket. El nombre mostrado es el más reciente.
-- Cuenta órdenes recibidas sin las canceladas/rechazadas. Ventanas:
--   d7 / prev7: últimas 168 h vs. las 168 h anteriores (ritmo; no lo sesga el día a medias)
--   active7: días calendario (zona horaria de cada cuenta) con al menos una orden, de hoy hacia 6 días atrás
--   30 días: ticket promedio, unidades por orden, lo que te toca por orden y tasa de entrega
--   daily: órdenes por día de los últimos 14 días (para la mini gráfica)
create or replace function public.store_health(p_account uuid)
returns jsonb language sql stable as $$
  with base as (
    select o.id, o.account_id, a.name account_name, coalesce(o.currency, a.currency) currency, o.dropshipper,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) store_id,
      o.ordered_at, (o.ordered_at at time zone a.timezone)::date d, (now() at time zone a.timezone)::date today,
      o.total, o.vendor_amount,
      public.status_group(o.status_code) g
    from public.orders o join public.accounts a on a.id = o.account_id
    where o.dropshipper is not null and o.ordered_at >= now() - interval '60 days'
      and (p_account is null or o.account_id = p_account)
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  units as (
    select i.order_id, sum(i.quantity) u
    from public.order_items i join base b on b.id = i.order_id
    where b.ordered_at >= now() - interval '30 days'
    group by 1
  ),
  daily as (
    select account_id, store_id, d, count(*) n from base where d > today - 14 group by 1, 2, 3
  )
  select coalesce(jsonb_agg(row_to_json(s) order by s.d7 desc, s.n30 desc), '[]'::jsonb) from (
    select b.account_id, b.store_id, max(b.account_name) account_name, max(b.currency) currency,
      (array_agg(b.dropshipper order by b.ordered_at desc))[1] name,
      count(*) filter (where b.d = b.today) today,
      count(*) filter (where b.ordered_at >= now() - interval '7 days') d7,
      count(*) filter (where b.ordered_at >= now() - interval '14 days' and b.ordered_at < now() - interval '7 days') prev7,
      count(distinct b.d) filter (where b.d > b.today - 7) active7,
      count(distinct b.d) filter (where b.d > b.today - 14 and b.d <= b.today - 7) active_prev7,
      max(b.ordered_at) last_at,
      b.today - max(b.d) days_since,
      count(*) filter (where b.ordered_at >= now() - interval '30 days') n30,
      round(avg(b.total) filter (where b.ordered_at >= now() - interval '30 days'), 2) ticket,
      round(avg(b.vendor_amount) filter (where b.ordered_at >= now() - interval '30 days'), 2) vendor_per_order,
      round(avg(u.u), 2) units_per_order,
      count(*) filter (where b.g = 'delivered' and b.ordered_at >= now() - interval '30 days') delivered30,
      count(*) filter (where b.g = 'failed' and b.ordered_at >= now() - interval '30 days') failed30,
      (select jsonb_agg(coalesce(dl.n, 0) order by gs)
         from generate_series(b.today - 13, b.today, interval '1 day') gs
         left join daily dl on dl.account_id = b.account_id and dl.store_id = b.store_id and dl.d = gs::date) daily
    from base b left join units u on u.order_id = b.id
    group by b.account_id, b.store_id, b.today
  ) s
$$;

revoke all on function public.store_health(uuid) from public, anon, authenticated;
grant execute on function public.store_health(uuid) to service_role;
