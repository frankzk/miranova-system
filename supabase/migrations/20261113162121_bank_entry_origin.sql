-- Conciliación: de qué operación (Miranova o Mireva) y de qué país viene cada transferencia de Boxful.
-- Es una clasificación aparte del movimiento: se puede indicar o corregir aunque ya esté conciliado, sin
-- cambiar su versión (las conciliaciones guardan la versión que cuadraron) y queda en la auditoría.
-- Las existentes se completan con lo que dice su referencia, notas o el nombre del PDF (lib/bank-origin.ts).

set local lock_timeout = '5s';

alter table public.bank_entries
  add column if not exists origin_operation text check (origin_operation in ('miranova', 'mireva')),
  add column if not exists origin_country text check (origin_country in ('HN', 'GT', 'SV', 'CR'));

create or replace function public.bank_guard_entry() returns trigger language plpgsql security invoker set search_path = '' as $$
declare ignore text[] := array['origin_operation', 'origin_country', 'updated_by', 'updated_at', 'reference_key', 'version'];
begin
  if TG_OP = 'DELETE' then raise exception 'Los movimientos no se borran. Anúlalos con un motivo.'; end if;
  if OLD.void_reason is not null then raise exception 'Un movimiento anulado conserva sus datos originales.'; end if;
  -- solo la operación y el país de origen: se puede siempre (también conciliado) y no cambia la versión
  if (to_jsonb(NEW) - ignore) = (to_jsonb(OLD) - ignore) then
    NEW.version := OLD.version;
    NEW.updated_at := now();
    return NEW;
  end if;
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

-- Relleno inicial (sin auditoría: no lo hizo una persona). Mismas reglas que guessOrigin.
alter table public.bank_entries disable trigger bank_audit_entry;
with t as (
  select id, translate(upper(reference || ' ' || notes || ' ' || coalesce(document_name, '')), 'ÁÉÍÓÚÜÑ', 'AEIOUUN') as x
  from public.bank_entries
  where source = 'boxful' and void_reason is null and origin_operation is null and origin_country is null
), g as (
  select id,
    x ~ '(^|[^A-Z])MIREVA([^A-Z]|$)' as mireva,
    x ~ '(^|[^A-Z])MIRANOVA([^A-Z]|$)' as miranova,
    x ~ '(^|[^A-Z0-9])(HN|HONDURAS)([^A-Z0-9]|$)' as hn,
    x ~ '(^|[^A-Z0-9])(GT|GUATEMALA)([^A-Z0-9]|$)' as gt,
    x ~ '(^|[^A-Z0-9])(SV|SALVADOR)([^A-Z0-9]|$)' as sv,
    x ~ '(^|[^A-Z0-9])(CR|COSTA RICA)([^A-Z0-9]|$)' as cr
  from t
)
update public.bank_entries e set
  origin_operation = case when g.mireva and not g.miranova then 'mireva' when g.miranova and not g.mireva then 'miranova' end,
  origin_country = case when g.hn::int + g.gt::int + g.sv::int + g.cr::int <> 1 then null
    when g.hn then 'HN' when g.gt then 'GT' when g.sv then 'SV' else 'CR' end
from g
where e.id = g.id and (g.mireva or g.miranova or g.hn or g.gt or g.sv or g.cr);
alter table public.bank_entries enable trigger bank_audit_entry;
