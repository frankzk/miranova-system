-- Base para el sistema de gestión: vistas de hechos por pedido y por línea de producto,
-- extraídas del JSON original de cada plataforma, más tipo de cambio a USD y motivos
-- de rechazo agrupados. Las tiendas y los productos se identifican por su ID, no por
-- su nombre (dos tiendas distintas pueden llamarse igual y un producto puede cambiar
-- de nombre: en Drop el nombre de la línea es el que tenía al momento de la venta).

-- ID del producto en cada línea (Drop: productId; Dropi: product.id). Lo guarda el
-- normalizador; aquí se completa el historial desde el JSON (misma posición de línea).
alter table public.order_items add column if not exists product_external_id text;

update public.order_items i
set product_external_id = coalesce(
  o.raw->'productSnapshots'->i.position->>'productId',
  o.raw->'orderdetails'->i.position->'product'->>'id',
  o.raw->'orderdetails'->i.position->>'product_id')
from public.orders o
where o.id = i.order_id and i.product_external_id is null;

create index if not exists order_items_product_idx on public.order_items (product_external_id);

-- Si una versión del código no lo envía, se toma del JSON del pedido al insertar la línea.
create or replace function public.fill_item_product_id()
returns trigger language plpgsql as $$
begin
  if new.product_external_id is null then
    select coalesce(o.raw->'productSnapshots'->new.position->>'productId',
                    o.raw->'orderdetails'->new.position->'product'->>'id',
                    o.raw->'orderdetails'->new.position->>'product_id')
      into new.product_external_id
    from public.orders o where o.id = new.order_id;
  end if;
  return new;
end
$$;

drop trigger if exists order_items_product_id on public.order_items;
create trigger order_items_product_id
  before insert on public.order_items
  for each row execute function public.fill_item_product_id();

-- Motivo de rechazo (texto libre en Drop) → categoría.
create or replace function public.reject_category(reason text)
returns text language sql immutable as $$
  select case
    when reason is null or btrim(reason) = '' then null
    when reason ~* '(inventario|stock|no disponible|agotad)' then 'stock'
    when reason ~* '(cobertura|covertura|no cubre)' then 'cobertura'
    when reason ~* '(direcci|ubicaci|municipio|ciudad|tel[eé]fono|d[ií]gito)' then 'datos_cliente'
    when reason ~* '(cliente|solicitud)' then 'cliente'
    when reason ~* '(descripci|producto)' then 'producto'
    else 'otro'
  end
$$;

-- Tipo de cambio a USD de cada cuenta. Drop lo informa en el catálogo
-- (currencyExchangeRate); es una foto del día, no un histórico.
create or replace view public.account_fx with (security_invoker = true) as
select a.id as account_id, a.currency,
  case when a.currency = 'USD' then 1::numeric
       else (select (p.raw->>'currencyExchangeRate')::numeric
             from public.products p
             where p.account_id = a.id and (p.raw->>'currencyExchangeRate') ~ '^[0-9.]+$'
             order by p.updated_at desc limit 1)
  end as usd_rate
from public.accounts a;

-- Un pedido por fila, con tienda por ID, hitos del envío, liquidación, rechazos y USD.
create or replace view public.order_facts with (security_invoker = true) as
select
  o.id as order_id,
  o.account_id,
  a.platform,
  a.country,
  o.currency,
  o.external_id,
  o.ordered_at,
  o.status_code,
  o.status,
  public.status_group(o.status_code) as grp,
  -- tienda: ID de la plataforma; si no hay, el nombre
  coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
  o.dropshipper as store_name,
  o.carrier,
  o.department,
  o.city,
  o.total,
  o.vendor_amount,
  o.vendor_net,
  o.vendor_amount - o.vendor_net as platform_deduction,
  o.shipping_cost,
  o.cod,
  o.paid,
  (o.raw->'payment'->>'paidAt')::timestamptz as paid_at,
  fx.usd_rate,
  round(o.vendor_amount * fx.usd_rate, 2) as vendor_amount_usd,
  round(o.vendor_net * fx.usd_rate, 2) as vendor_net_usd,
  tl.registered_at,
  tl.dispatched_at,
  tl.picked_up_at,
  tl.delivered_at,
  tl.failed_at,
  tl.last_status_at,
  rj.rejections,
  rj.stock_rejections,
  rj.last_rejection_at,
  rj.last_rejection_reason,
  public.reject_category(rj.last_rejection_reason) as last_rejection_category
from public.orders o
join public.accounts a on a.id = o.account_id
left join public.account_fx fx on fx.account_id = o.account_id
left join lateral (
  select
    min((e->>'occurredAt')::timestamptz) filter (where e->>'status' = 'registered') as registered_at,
    min((e->>'occurredAt')::timestamptz) filter (where e->>'status' = 'fulfilled') as dispatched_at,
    min((e->>'occurredAt')::timestamptz) filter (where e->>'status' = '2') as picked_up_at,
    min((e->>'occurredAt')::timestamptz) filter (where e->>'status' = '4') as delivered_at,
    min((e->>'occurredAt')::timestamptz) filter (where e->>'status' in ('7', '8')) as failed_at,
    max((e->>'occurredAt')::timestamptz) as last_status_at
  from jsonb_array_elements(case when jsonb_typeof(o.raw->'orderInfo'->'statusTimeline') = 'array'
                                 then o.raw->'orderInfo'->'statusTimeline' else '[]'::jsonb end) e
) tl on true
left join lateral (
  select
    count(*) as rejections,
    count(*) filter (where public.reject_category(r->>'rejectionReason') = 'stock') as stock_rejections,
    max((r->>'rejectedAt')::timestamptz) as last_rejection_at,
    (array_agg(btrim(r->>'rejectionReason') order by r->>'rejectedAt' desc))[1] as last_rejection_reason
  from jsonb_array_elements(case when jsonb_typeof(o.raw->'orderRejections') = 'array'
                                 then o.raw->'orderRejections' else '[]'::jsonb end) r
) rj on true;

-- Una línea de producto por fila. En Drop los precios de línea ya vienen
-- multiplicados por la cantidad; en Dropi `price` y `supplier_price` son unitarios.
create or replace view public.line_facts with (security_invoker = true) as
with lines as (
  select o.id as order_id, o.account_id, l.pos,
    l.p->>'productId' as product_external_id,
    l.p->>'productVariantId' as variant_id,
    l.p->>'sku' as sku,
    concat_ws(' — ', l.p->>'productName', l.p->>'variantName') as name_at_sale,
    greatest(coalesce((l.p->>'quantity')::int, 1), 1) as quantity,
    (l.p->>'sellerUnitPrice')::numeric as unit_price,
    (l.p->>'sellerPrice')::numeric as line_total,
    (l.p->>'vendorUnitPrice')::numeric as vendor_unit_price,
    (l.p->>'vendorPrice')::numeric as vendor_line_total
  from public.orders o,
    jsonb_array_elements(o.raw->'productSnapshots') with ordinality l(p, pos)
  where jsonb_typeof(o.raw->'productSnapshots') = 'array'
  union all
  select o.id, o.account_id, l.pos,
    coalesce(l.p->'product'->>'id', l.p->>'product_id'),
    l.p->'variation'->>'id',
    coalesce(l.p->'variation'->>'sku', l.p->'product'->>'sku'),
    concat_ws(' — ', l.p->'product'->>'name', l.p->'variation'->>'name'),
    greatest(coalesce((l.p->>'quantity')::int, 1), 1),
    (l.p->>'price')::numeric,
    (l.p->>'price')::numeric * greatest(coalesce((l.p->>'quantity')::int, 1), 1),
    (l.p->>'supplier_price')::numeric,
    (l.p->>'supplier_price')::numeric * greatest(coalesce((l.p->>'quantity')::int, 1), 1)
  from public.orders o,
    jsonb_array_elements(o.raw->'orderdetails') with ordinality l(p, pos)
  where jsonb_typeof(o.raw->'orderdetails') = 'array'
)
-- (se une a orders y no a order_facts para no calcular el historial de estados
-- de cada pedido cuando solo se necesitan las líneas)
select
  l.order_id,
  l.account_id,
  a.country,
  o.ordered_at,
  public.status_group(o.status_code) as grp,
  coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
  o.dropshipper as store_name,
  l.pos,
  pr.id as product_id,
  coalesce(l.product_external_id, 'sku:' || l.sku) as product_key,
  l.product_external_id,
  l.variant_id,
  l.sku,
  coalesce(pr.name, l.name_at_sale) as product_name,
  l.name_at_sale,
  pr.raw->>'category' as category,
  l.quantity,
  l.unit_price,
  l.line_total,
  l.vendor_unit_price,
  l.vendor_line_total,
  round(l.vendor_line_total * fx.usd_rate, 2) as vendor_line_total_usd
from lines l
join public.orders o on o.id = l.order_id
join public.accounts a on a.id = l.account_id
left join public.account_fx fx on fx.account_id = l.account_id
left join public.products pr on pr.account_id = l.account_id and pr.external_id = l.product_external_id;

-- Las vistas son solo para el backend (service role), como las tablas.
revoke all on public.account_fx, public.order_facts, public.line_facts from public, anon, authenticated;
grant select on public.account_fx, public.order_facts, public.line_facts to service_role;
revoke all on function public.reject_category(text) from public, anon, authenticated;
grant execute on function public.reject_category(text) to service_role;

-- Inicio: tiendas agrupadas por ID y productos por ID con su nombre actual.
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
    select max(dropshipper) as name, count(*) as orders,
      count(*) filter (where grp = 'delivered') as delivered,
      count(*) filter (where grp = 'problem') as problems
    from period where dropshipper is not null
    group by coalesce(raw->'seller'->>'sellerId', raw->'user'->>'id', dropshipper)
    order by orders desc limit 6
  ),
  products as (
    select coalesce(max(pr.name), max(i.product_name)) as name, sum(i.quantity) as units, count(distinct p.id) as orders
    from period p
    join public.order_items i on i.order_id = p.id
    left join public.products pr on pr.account_id = p.account_id and pr.external_id = i.product_external_id
    where p.grp is distinct from 'cancelled'
    group by p.account_id, coalesce(i.product_external_id, i.product_name)
    order by units desc limit 6
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

-- Productos: además de "cuenta:SKU", ventas por "cuenta:id:<id del producto>",
-- que no se rompe si el producto cambia de nombre o de SKU.
create or replace function public.product_sales(p_account uuid, p_from timestamptz)
returns jsonb language sql stable as $$
  with l as (
    select o.account_id, i.product_external_id, i.sku, i.product_name, i.quantity, o.id as order_id
    from public.orders o join public.order_items i on i.order_id = o.id
    where (p_account is null or o.account_id = p_account)
      and o.ordered_at >= p_from
      and public.status_group(o.status_code) is distinct from 'cancelled'
  ),
  keyed as (
    select account_id::text || ':' || coalesce(nullif(sku, ''), product_name) as k, quantity, order_id from l
    union all
    select account_id::text || ':id:' || product_external_id, quantity, order_id from l where product_external_id is not null
  )
  select coalesce(jsonb_object_agg(k, jsonb_build_object('units', units, 'orders', orders)), '{}'::jsonb) from (
    select k, sum(quantity) as units, count(distinct order_id) as orders from keyed group by k
  ) s
$$;
