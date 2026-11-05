-- Solicitudes de clientes potenciales (todavía no son tiendas) y tipo de solicitud: centraliza las
-- oportunidades nuevas (maquila, desarrollo de producto) junto a lo que piden las tiendas.
--   client_kind:   'store' (tienda que vende en Drop) o 'prospect' (cliente potencial). store_name
--                  guarda el nombre de uno u otro; owner_name, el dueño o la persona de contacto.
--   request_type:  'product' (pedido de un producto para vender), 'maquila' o 'development'
--                  (desarrollo de producto).
--   contact_phone: teléfono del cliente en dígitos con código de país (opcional).
--   contact_email: correo del cliente (opcional).
-- Las solicitudes que ya existen quedan como pedidos de producto de tiendas.

set lock_timeout = '5s';

alter table public.store_requests add column if not exists client_kind text not null default 'store';
alter table public.store_requests add column if not exists request_type text not null default 'product';
alter table public.store_requests add column if not exists contact_phone text;
alter table public.store_requests add column if not exists contact_email text;

alter table public.store_requests drop constraint if exists store_requests_client_kind_check;
alter table public.store_requests add constraint store_requests_client_kind_check check (client_kind in ('store', 'prospect'));
alter table public.store_requests drop constraint if exists store_requests_request_type_check;
alter table public.store_requests add constraint store_requests_request_type_check check (request_type in ('product', 'maquila', 'development'));
