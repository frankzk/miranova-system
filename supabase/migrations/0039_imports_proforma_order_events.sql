-- Importaciones: proforma invoice como tipo de documento aparte, número de orden de la plataforma
-- (Alibaba u otra) y tipo de cada evento del historial, para registrar también lo que se agrega o
-- quita sin que cuente como novedad del envío.

alter table public.import_documents drop constraint if exists import_documents_kind_check;
alter table public.import_documents add constraint import_documents_kind_check
  check (kind in ('invoice', 'proforma', 'payment', 'tracking', 'packing', 'customs', 'photo', 'other'));

alter table public.imports add column if not exists order_ref text;  -- n.º de orden en Alibaba u otra plataforma

-- status: cambios de estado, notas, aviso y recepción · tracking: novedades de la paquetera ·
-- activity: productos, documentos y datos · money: costos y pagos (solo con permiso de Dinero)
alter table public.import_events add column if not exists kind text not null default 'status';
