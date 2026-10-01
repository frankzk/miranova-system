-- Correo de la tienda y "Tiendas nuevas".
--
-- 1) store_contacts.email: correo de la tienda cargado a mano. Tiene prioridad sobre el detectado.
alter table public.store_contacts add column if not exists email text;

-- 2) store_profiles(): una fila por tienda (cuenta + store_id, como store_directory) con su
--    ingreso (primer pedido), último pedido, el dueño según Drop (seller.lastName) y el correo
--    detectado en los pedidos.
--    Drop no manda el correo de la tienda, pero muchas tiendas ponen el suyo en el correo del
--    cliente: un mismo correo en pedidos de 3 o más clientes distintos (por teléfono) es el de la
--    tienda. Se descartan los correos que usan 3 o más tiendas con nombres distintos (relleno,
--    p. ej. "sincorreo@…"). Se recalcula con cada consulta: las tiendas nuevas aparecen solas
--    con la sincronización.
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
      o.customer_phone
    from public.orders o
    where o.dropshipper is not null
  ),
  stores as (
    select b.account_id, b.store_id,
      (array_agg(b.dropshipper order by b.ordered_at desc))[1] as name,
      (array_agg(b.person order by b.ordered_at desc) filter (where b.person is not null))[1] as person,
      min(b.ordered_at) as first_at,
      max(b.ordered_at) as last_at,
      count(*) as orders
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
