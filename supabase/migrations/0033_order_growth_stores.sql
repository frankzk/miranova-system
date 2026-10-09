-- Inicio › Órdenes: qué tiendas explican el crecimiento o la caída. order_growth agrega, por
-- tienda, lo que va del período en curso contra el mismo tramo del anterior (semana y mes), con
-- las mismas reglas de 0032 (órdenes recibidas, hasta el mismo día y hora, zona de la cuenta).
--   week_stores / month_stores: tiendas cuyo número cambió (cur <> prev), de la que más bajó a
--   la que más subió. Sumadas dan exactamente la diferencia total del período.
create or replace function public.order_growth(p_account uuid)
returns jsonb language sql stable as $$
  with o as (
    select o.account_id, a.name as account_name, o.dropshipper,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || coalesce(o.dropshipper, '')) as store_id,
      (o.ordered_at at time zone a.timezone) as t, (now() at time zone a.timezone) as n
    from public.orders o join public.accounts a on a.id = o.account_id
    where p_account is null or o.account_id = p_account
  ),
  b as (
    select account_id, account_name, dropshipper, store_id, t, date_trunc('week', n) as w0, n - date_trunc('week', n) as ew,
      date_trunc('month', n) as m0, n - date_trunc('month', n) as em
    from o
  ),
  x as (
    select account_id, account_name, dropshipper, store_id, t,
      (w0::date - date_trunc('week', t)::date) / 7 as wk,
      ((extract(year from m0) - extract(year from t)) * 12 + extract(month from m0) - extract(month from t))::int as mk,
      t >= w0 - interval '7 days' and t < w0 - interval '7 days' + ew as prev_wtd,
      t >= m0 - interval '1 month' and t < least(m0 - interval '1 month' + em, m0) as prev_mtd
    from b
  ),
  -- "ahora" para las etiquetas: la zona de la cuenta elegida, o la de Honduras si no hay pedidos
  ref as (
    select coalesce(
      (select now() at time zone a.timezone from public.accounts a where a.id = p_account),
      (select max(n) from o),
      now() at time zone 'America/Tegucigalpa'
    ) as n
  ),
  wk as (select wk, count(*) as c from x where wk between 0 and 11 group by 1),
  mk as (select mk, count(*) as c from x where mk between 0 and 11 group by 1),
  -- por tienda: lo que va del período en curso contra el mismo tramo del anterior
  st as (
    select account_id, store_id, max(account_name) as account_name,
      (array_agg(dropshipper order by t desc) filter (where dropshipper is not null))[1] as name,
      count(*) filter (where wk = 0) as w_cur, count(*) filter (where prev_wtd) as w_prev,
      count(*) filter (where mk = 0) as m_cur, count(*) filter (where prev_mtd) as m_prev
    from x where wk = 0 or prev_wtd or mk = 0 or prev_mtd
    group by 1, 2
  )
  select jsonb_build_object(
    'now', to_char(ref.n, 'YYYY-MM-DD"T"HH24:MI'),
    'weeks', (select jsonb_agg(jsonb_build_object('k', k, 'start', to_char(date_trunc('week', ref.n) - k * interval '7 days', 'YYYY-MM-DD'),
        'orders', coalesce(wk.c, 0)) order by k desc)
      from generate_series(0, 11) k left join wk on wk.wk = k),
    'months', (select jsonb_agg(jsonb_build_object('k', k, 'month', to_char(date_trunc('month', ref.n) - k * interval '1 month', 'YYYY-MM'),
        'orders', coalesce(mk.c, 0)) order by k desc)
      from generate_series(0, 11) k left join mk on mk.mk = k),
    'week_prev_to_date', (select count(*) from x where prev_wtd),
    'month_prev_to_date', (select count(*) from x where prev_mtd),
    'week_stores', coalesce((select jsonb_agg(jsonb_build_object('account_id', account_id, 'store_id', store_id,
        'account_name', account_name, 'name', name, 'cur', w_cur, 'prev', w_prev) order by w_cur - w_prev)
      from st where w_cur <> w_prev), '[]'::jsonb),
    'month_stores', coalesce((select jsonb_agg(jsonb_build_object('account_id', account_id, 'store_id', store_id,
        'account_name', account_name, 'name', name, 'cur', m_cur, 'prev', m_prev) order by m_cur - m_prev)
      from st where m_cur <> m_prev), '[]'::jsonb)
  )
  from ref
$$;

revoke all on function public.order_growth(uuid) from public, anon, authenticated;
grant execute on function public.order_growth(uuid) to service_role;
