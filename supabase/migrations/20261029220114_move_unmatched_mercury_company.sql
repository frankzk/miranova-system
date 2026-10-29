-- Permite clasificar un abono Mercury sin alterar conciliaciones ni PDFs históricos.
set local lock_timeout = '5s';
create or replace function public.bank_guard_entry() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then raise exception 'Los movimientos no se borran. Anúlalos con un motivo.'; end if;
  if OLD.void_reason is not null then raise exception 'Un movimiento anulado conserva sus datos originales.'; end if;
  if exists (select 1 from public.bank_matches where reversed_at is null and (boxful_id = OLD.id or mercury_id = OLD.id)) then
    raise exception 'Revierte la conciliación antes de modificar o anular el movimiento.';
  end if;
  if NEW.company <> OLD.company and (OLD.source <> 'mercury' or OLD.document_path is not null or
    exists (select 1 from public.bank_matches where boxful_id = OLD.id or mercury_id = OLD.id)) then
    raise exception 'Solo se puede cambiar la empresa de un abono Mercury sin PDF y sin historial de conciliación.';
  end if;
  if NEW.id <> OLD.id or NEW.source <> OLD.source or NEW.created_by <> OLD.created_by or NEW.created_at <> OLD.created_at or
    NEW.document_path is distinct from OLD.document_path or NEW.document_name is distinct from OLD.document_name or NEW.document_sha256 is distinct from OLD.document_sha256 then
    raise exception 'No se puede cambiar el origen ni el PDF de un registro.';
  end if;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  return NEW;
end $$;
