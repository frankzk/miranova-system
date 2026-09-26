-- Agregados para el panel, calculados en la base (PostgREST limita a 1000 filas por consulta).
-- Mantener status_group sincronizado con lib/status.ts.

create or replace function public.status_group(code text)
returns text language sql immutable as $$
  select case
    when code in ('registered', 'pending', 'fulfilled') then 'dispatch'
    when code in ('1', '2', '3') then 'transit'
    when code = '4' then 'delivered'
    when code in ('pending_correction', '6') then 'problem'
    when code in ('7', '8') then 'failed'
    when code in ('5', 'cancelled', 'rejected') then 'cancelled'
    else null
  end
$$;

create index if not exists orders_group_idx on public.orders (public.status_group(status_code));

-- Resumen de Inicio: estado actual, cifras del período por moneda, serie diaria y rankings.
drop function if exists public.dashboard_summary(uuid, timestamptz, timestamptz, text);

create or replace function public.dashboard_summary(p_account uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_bucket text)
returns jsonb language sql stable as $$
  with base as (
    select o.*, public.status_group(o.status_code) as grp
    from public.orders o
    where (p_account is null or o.account_id = p_account)
  ),
  period as (
    select * from base where ordered_at >= p_from and ordered_at <= p_to
  ),
  -- estado actual de todas las órdenes (sin importar el período)
  snapshot as (
    select grp, count(*) as n from base group by grp
  ),
  money as (
    select coalesce(currency, 'HNL') as currency,
      count(*) as orders,
      count(*) filter (where grp = 'delivered') as delivered,
      coalesce(sum(total) filter (where grp is distinct from 'cancelled'), 0) as sales,
      coalesce(sum(vendor_amount) filter (where grp = 'delivered'), 0) as vendor_delivered,
      coalesce(sum(vendor_amount) filter (where grp = 'delivered' and paid), 0) as vendor_paid,
      coalesce(sum(vendor_amount) filter (where grp = 'delivered' and not coalesce(paid, false)), 0) as vendor_unpaid,
      coalesce(sum(vendor_net) filter (where grp = 'delivered'), 0) as vendor_net,
      coalesce(sum(vendor_amount) filter (where grp in ('dispatch', 'transit')), 0) as vendor_in_flight
    from period group by 1
  ),
  -- lo entregado y aún no liquidado, sin importar el período
  unpaid as (
    select coalesce(currency, 'HNL') as currency, count(*) as orders, coalesce(sum(vendor_amount), 0) as amount
    from base where grp = 'delivered' and not coalesce(paid, false)
    group by 1
  ),
  -- serie por día, o por hora cuando el período es un solo día (p_bucket = 'hour')
  days as (
    select d as day
    from generate_series(
      date_trunc(p_bucket, p_from at time zone p_tz),
      date_trunc(p_bucket, p_to at time zone p_tz),
      case when p_bucket = 'hour' then interval '1 hour' else interval '1 day' end
    ) d
  ),
  daily as (
    select date_trunc(p_bucket, ordered_at at time zone p_tz) as day,
      count(*) as orders,
      count(*) filter (where grp = 'delivered') as delivered,
      count(*) filter (where grp = 'problem') as problems
    from period group by 1
  ),
  sellers as (
    select dropshipper as name, count(*) as orders,
      count(*) filter (where grp = 'delivered') as delivered,
      count(*) filter (where grp = 'problem') as problems
    from period where dropshipper is not null
    group by 1 order by 2 desc limit 6
  ),
  products as (
    select i.product_name as name, sum(i.quantity) as units, count(distinct p.id) as orders
    from period p join public.order_items i on i.order_id = p.id
    where p.grp is distinct from 'cancelled'
    group by 1 order by 2 desc limit 6
  ),
  carriers as (
    select carrier as name, count(*) as orders,
      count(*) filter (where grp = 'delivered') as delivered,
      count(*) filter (where grp = 'problem') as problems
    from period where carrier is not null
    group by 1 order by 2 desc limit 6
  )
  select jsonb_build_object(
    'snapshot', coalesce((select jsonb_object_agg(coalesce(grp, 'other'), n) from snapshot), '{}'::jsonb),
    'money', coalesce((select jsonb_agg(to_jsonb(m) order by m.orders desc) from money m), '[]'::jsonb),
    'unpaid', coalesce((select jsonb_agg(to_jsonb(u) order by u.amount desc) from unpaid u), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', to_char(d.day, 'YYYY-MM-DD"T"HH24:MI'), 'orders', coalesce(x.orders, 0), 'delivered', coalesce(x.delivered, 0), 'problems', coalesce(x.problems, 0)
      ) order by d.day) from days d left join daily x on x.day = d.day), '[]'::jsonb),
    'sellers', coalesce((select jsonb_agg(to_jsonb(s)) from sellers s), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(p)) from products p), '[]'::jsonb),
    'carriers', coalesce((select jsonb_agg(to_jsonb(c)) from carriers c), '[]'::jsonb)
  )
$$;

-- Dinero por mes, cuenta y moneda.
create or replace function public.money_by_month(p_account uuid, p_months int, p_tz text)
returns jsonb language sql stable as $$
  with base as (
    select o.*, public.status_group(o.status_code) as grp,
      date_trunc('month', o.ordered_at at time zone p_tz)::date as month
    from public.orders o
    where (p_account is null or o.account_id = p_account)
      and o.ordered_at >= date_trunc('month', now() at time zone p_tz) - make_interval(months => p_months - 1)
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.month desc, r.account_name), '[]'::jsonb) from (
    select b.month, a.name as account_name, coalesce(b.currency, 'HNL') as currency,
      count(*) as orders,
      count(*) filter (where grp = 'delivered') as delivered,
      count(*) filter (where grp = 'problem') as problems,
      count(*) filter (where grp = 'cancelled') as cancelled,
      coalesce(sum(total) filter (where grp is distinct from 'cancelled'), 0) as sales,
      coalesce(sum(vendor_amount) filter (where grp = 'delivered'), 0) as vendor_delivered,
      coalesce(sum(vendor_amount) filter (where grp = 'delivered' and paid), 0) as vendor_paid,
      coalesce(sum(vendor_amount) filter (where grp = 'delivered' and not coalesce(paid, false)), 0) as vendor_unpaid,
      coalesce(sum(vendor_net) filter (where grp = 'delivered'), 0) as vendor_net
    from base b left join public.accounts a on a.id = b.account_id
    group by 1, 2, 3
  ) r
$$;

-- Valores para los filtros (sin el límite de 1000 filas).
create or replace function public.order_facets(p_account uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'dropshippers', coalesce((select jsonb_agg(x order by x) from (
      select distinct dropshipper x from public.orders where dropshipper is not null and (p_account is null or account_id = p_account)) s), '[]'::jsonb),
    'carriers', coalesce((select jsonb_agg(x order by x) from (
      select distinct carrier x from public.orders where carrier is not null and (p_account is null or account_id = p_account)) s), '[]'::jsonb),
    -- estado exacto (dentro de cada grupo de las pestañas), con su nombre más reciente
    'statuses', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'group', grp, 'n', n) order by n desc) from (
      select status_code code, (array_agg(status order by updated_at desc))[1] label, public.status_group(status_code) grp, count(*) n
      from public.orders where status_code is not null and (p_account is null or account_id = p_account) group by status_code) s), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('name', x, 'n', n) order by x) from (
      select department x, count(*) n from public.orders where department is not null and department <> '' and (p_account is null or account_id = p_account) group by 1) s), '[]'::jsonb),
    -- productos más pedidos (hasta 300) para filtrar órdenes que los contienen
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', x, 'n', n) order by n desc, x) from (
      select i.product_name x, count(distinct o.id) n from public.orders o join public.order_items i on i.order_id = o.id
      where (p_account is null or o.account_id = p_account) group by 1 order by 2 desc limit 300) s), '[]'::jsonb)
  )
$$;

-- Solo el backend (service role) puede llamarlas.
revoke all on function public.status_group(text) from public, anon, authenticated;
revoke all on function public.dashboard_summary(uuid, timestamptz, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.money_by_month(uuid, int, text) from public, anon, authenticated;
revoke all on function public.order_facets(uuid) from public, anon, authenticated;
grant execute on function public.status_group(text) to service_role;
grant execute on function public.dashboard_summary(uuid, timestamptz, timestamptz, text, text) to service_role;
grant execute on function public.money_by_month(uuid, int, text) to service_role;
grant execute on function public.order_facets(uuid) to service_role;
