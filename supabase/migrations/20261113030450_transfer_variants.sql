-- Traslados: la variante de cada producto (color, talla…). Cada variante con cantidad es una línea propia.
--   variant: nombre de la variante ("Negro / XL"); variant_id: su id en Drop si salió del catálogo.

set lock_timeout = '5s';

alter table public.transfer_items add column if not exists variant text check (variant is null or length(variant) between 1 and 80);
alter table public.transfer_items add column if not exists variant_id text check (variant_id is null or length(variant_id) between 1 and 80);
