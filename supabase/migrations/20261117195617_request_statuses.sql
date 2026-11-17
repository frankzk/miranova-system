-- Solicitudes: el recorrido completo del producto. Se conservan los estados de siempre (pending = Solicitado por
-- el cliente, in_progress = En tránsito a país de destino, done = Ingresado a inventario Drop, dropped = Descartada)
-- y se agregan los pasos intermedios. Solo amplía la regla: no cambia ninguna solicitud existente.
set local lock_timeout = '5s';

alter table public.store_requests drop constraint if exists store_requests_status_check;
alter table public.store_requests add constraint store_requests_status_check
  check (status in ('pending', 'lab_requested', 'gt_received', 'in_progress', 'dest_verified', 'done', 'dropped'));
