-- Solicitudes de tiendas: fecha de solicitud, fecha de llegada y país de origen del producto.
--   requested_at: el día que la tienda lo pidió (por defecto, hoy en Honduras). Las que ya existen
--                 toman el día en que se cargaron.
--   arrival_at:   para cuándo debe llegar (opcional).
--   origin_country: de dónde se traería el producto, p. ej. "China" (opcional, texto libre como en
--                 Importaciones).

set lock_timeout = '5s';

alter table public.store_requests add column if not exists requested_at date;
update public.store_requests
set requested_at = (created_at at time zone 'America/Tegucigalpa')::date
where requested_at is null;
alter table public.store_requests alter column requested_at set default ((now() at time zone 'America/Tegucigalpa')::date);
alter table public.store_requests alter column requested_at set not null;

alter table public.store_requests add column if not exists arrival_at date;
alter table public.store_requests add column if not exists origin_country text;

create index if not exists store_requests_requested_idx on public.store_requests (requested_at desc, created_at desc);
