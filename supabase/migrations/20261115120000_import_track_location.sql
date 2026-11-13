-- Importaciones: el lugar de la última novedad de la paquetera ("SHENZHEN - CHINA MAINLAND"), para saber si
-- el envío sigue en el país de origen, va en tránsito o ya está en el de destino (lib/track-place.ts).

set lock_timeout = '5s';

alter table public.imports add column if not exists track_location text;
