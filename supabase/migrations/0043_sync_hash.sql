-- Huella (sha1) de lo último que llegó de Drop por orden y por producto. La sincronización
-- revisa ~45 días de pedidos cada 10 minutos; con la huella solo reescribe los que cambiaron
-- (antes reescribía todos, con su JSON completo y sus líneas de producto).
-- Columnas sin valor por defecto: agregarlas no reescribe la tabla. Las filas existentes quedan
-- en null y se escriben una última vez en la siguiente sincronización.

set lock_timeout = '5s';

alter table public.orders add column if not exists sync_hash text;
alter table public.products add column if not exists sync_hash text;
