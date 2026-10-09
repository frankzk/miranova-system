-- ingest_log: la sincronización ya no guarda la respuesta completa de cada página (llegó a
-- ocupar 7.7 GB de los 7.8 GB de la base y nada la lee); solo la extensión guarda el payload,
-- para revisar el mapeo. Las filas de más de 14 días se borran al inicio de cada sincronización.
alter table public.ingest_log alter column payload drop not null;
