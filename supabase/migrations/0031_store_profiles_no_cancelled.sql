-- Tiendas nuevas con la misma regla que Inicio (active_stores): sin pedidos cancelados ni rechazados.
--   first_at (ingreso), last_at y orders cuentan solo pedidos no cancelados. Una tienda cuyos pedidos
--   fueron todos cancelados sigue en la lista (para su correo detectado) con first_at y last_at nulos
--   y 0 pedidos: aún no entró. El correo se sigue detectando en todos sus pedidos.
create or replace function public.store_profiles()
returns table (
  account_id uuid, store_id text, account_name text, country text, name text, person text,
  first_at timestamptz, last_at timestamptz, orders bigint, email text, email_orders bigint
)
language sql stable as $$
  with base as (
    select o.account_id,
      coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
      o.dropshipper, o.ordered_at,
      nullif(btrim(regexp_replace(o.raw->'seller'->>'lastName', '\s+', ' ', 'g')), '') as person,
      lower(btrim(o.customer_email)) as email,
      o.customer_phone,
      public.status_group(o.status_code) is not distinct from 'cancelled' as cancelled
    from public.orders o
    where o.dropshipper is not null
  ),
  stores as (
    select b.account_id, b.store_id,
      (array_agg(b.dropshipper order by b.ordered_at desc))[1] as name,
      (array_agg(b.person order by b.ordered_at desc) filter (where b.person is not null))[1] as person,
      min(b.ordered_at) filter (where not b.cancelled) as first_at,
      max(b.ordered_at) filter (where not b.cancelled) as last_at,
      count(*) filter (where not b.cancelled) as orders
    from base b
    group by 1, 2
  ),
  emails as (
    select b.account_id, b.store_id, b.email, count(*) as n, count(distinct b.customer_phone) as customers
    from base b
    where b.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    group by 1, 2, 3
  ),
  placeholder as (
    select e.email
    from emails e join stores s on s.account_id = e.account_id and s.store_id = e.store_id
    where e.customers >= 3
    group by e.email
    having count(distinct lower(s.name)) >= 3
  ),
  best as (
    select distinct on (e.account_id, e.store_id) e.account_id, e.store_id, e.email, e.n
    from emails e
    where e.customers >= 3 and e.email not in (select p.email from placeholder p)
    order by e.account_id, e.store_id, e.customers desc, e.n desc
  )
  select s.account_id, s.store_id, a.name, a.country, s.name, s.person, s.first_at, s.last_at, s.orders, b.email, b.n
  from stores s
  join public.accounts a on a.id = s.account_id
  left join best b on b.account_id = s.account_id and b.store_id = s.store_id
$$;

revoke all on function public.store_profiles() from public, anon, authenticated;
grant execute on function public.store_profiles() to service_role;
