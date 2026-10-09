-- Inicio › Órdenes: crecimiento semana a semana y mes a mes, con una comparación justa del
-- período en curso: lo que va de esta semana (o mes) contra el mismo tramo del período anterior,
-- hasta el mismo día y la misma hora (zona de la cuenta). Así no hay que esperar a que termine.
--   Cuenta las órdenes recibidas (todas, como el gráfico diario de Inicio): las cancelaciones y
--   entregas llegan días después, y contarlas haría ver peor siempre al período en curso.
--   weeks: 12 semanas calendario (lunes a domingo; 0 = la actual) con su lunes y sus órdenes
--   months: 12 meses calendario (0 = el actual)
--   week_prev_to_date / month_prev_to_date: órdenes del período anterior hasta el mismo punto
--     (si el mes anterior es más corto, hasta su último día)
create or replace function public.order_growth(p_account uuid)
returns jsonb language sql stable as $$
  with o as (
    select (o.ordered_at at time zone a.timezone) as t, (now() at time zone a.timezone) as n
    from public.orders o join public.accounts a on a.id = o.account_id
    where p_account is null or o.account_id = p_account
  ),
  b as (
    select t, date_trunc('week', n) as w0, n - date_trunc('week', n) as ew,
      date_trunc('month', n) as m0, n - date_trunc('month', n) as em
    from o
  ),
  x as (
    select (w0::date - date_trunc('week', t)::date) / 7 as wk,
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
  mk as (select mk, count(*) as c from x where mk between 0 and 11 group by 1)
  select jsonb_build_object(
    'now', to_char(ref.n, 'YYYY-MM-DD"T"HH24:MI'),
    'weeks', (select jsonb_agg(jsonb_build_object('k', k, 'start', to_char(date_trunc('week', ref.n) - k * interval '7 days', 'YYYY-MM-DD'),
        'orders', coalesce(wk.c, 0)) order by k desc)
      from generate_series(0, 11) k left join wk on wk.wk = k),
    'months', (select jsonb_agg(jsonb_build_object('k', k, 'month', to_char(date_trunc('month', ref.n) - k * interval '1 month', 'YYYY-MM'),
        'orders', coalesce(mk.c, 0)) order by k desc)
      from generate_series(0, 11) k left join mk on mk.mk = k),
    'week_prev_to_date', (select count(*) from x where prev_wtd),
    'month_prev_to_date', (select count(*) from x where prev_mtd)
  )
  from ref
$$;

revoke all on function public.order_growth(uuid) from public, anon, authenticated;
grant execute on function public.order_growth(uuid) to service_role;
