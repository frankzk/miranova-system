-- Conciliación 1:1, siempre en USD; moneda original del PDF conservada por separado.
create table public.bank_entries (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('miranova', 'mireva')),
  source text not null check (source in ('boxful', 'mercury')),
  reference text not null check (length(btrim(reference)) between 1 and 160),
  reference_key text generated always as (lower(regexp_replace(btrim(reference), '\s+', ' ', 'g'))) stored,
  occurred_on date not null,
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  original_currency text not null check (original_currency in ('USD','HNL','GTQ','MXN','CRC','NIO','COP','EUR')),
  original_amount_cents bigint not null check (original_amount_cents between 1 and 999999999999),
  counterparty text not null default '' check (length(counterparty) <= 200),
  bank_account text not null default '' check (length(bank_account) <= 100),
  notes text not null default '' check (length(notes) <= 2000),
  document_path text, document_name text, document_sha256 text,
  created_by uuid not null, updated_by uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1,
  void_reason text check (length(btrim(void_reason)) between 3 and 500),
  unique (company, source, reference_key), unique (company, id),
  check (original_currency <> 'USD' or original_amount_cents = amount_cents),
  check (source <> 'mercury' or (original_currency = 'USD' and length(btrim(bank_account)) > 0 and length(btrim(counterparty)) > 0)),
  check (source <> 'boxful' or (document_path is not null and document_name is not null and document_sha256 is not null and document_sha256 ~ '^[a-f0-9]{64}$'))
);
create unique index bank_entries_pdf_unique on public.bank_entries(company, document_sha256) where document_sha256 is not null;
create index bank_entries_company_date on public.bank_entries(company, occurred_on desc, id);

create table public.bank_matches (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('miranova','mireva')),
  boxful_id uuid not null, mercury_id uuid not null,
  boxful_version integer not null, mercury_version integer not null,
  boxful_snapshot jsonb not null, mercury_snapshot jsonb not null,
  fee_cents bigint not null check (fee_cents between 0 and 999999999999),
  fee_note text not null default '' check (length(fee_note) <= 1000),
  created_by uuid not null, created_at timestamptz not null default now(),
  reversed_at timestamptz, reversed_by uuid, reversal_reason text,
  foreign key (company, boxful_id) references public.bank_entries(company,id),
  foreign key (company, mercury_id) references public.bank_entries(company,id),
  check (boxful_id <> mercury_id),
  check (fee_cents = 0 or length(btrim(fee_note)) > 0),
  check ((reversed_at is null and reversed_by is null and reversal_reason is null)
    or (reversed_at is not null and reversed_by is not null and reversal_reason is not null and length(btrim(reversal_reason)) between 3 and 500))
);
create unique index bank_matches_boxful_active on public.bank_matches(boxful_id) where reversed_at is null;
create unique index bank_matches_mercury_active on public.bank_matches(mercury_id) where reversed_at is null;
create index bank_matches_company_created on public.bank_matches(company, created_at desc);

create table public.bank_audit (
  id uuid primary key default gen_random_uuid(), company text not null,
  entity_id uuid not null, entity_type text not null, operation text not null,
  actor_id uuid not null, created_at timestamptz not null default now(), snapshot jsonb not null
);
create index bank_audit_company_created on public.bank_audit(company, created_at desc);

-- Se bloquean los dos movimientos antes de comprobarlos. Los índices únicos resuelven
-- los intentos simultáneos de usar un mismo movimiento en dos conciliaciones.
create function public.bank_guard_match() returns trigger language plpgsql security invoker set search_path = '' as $$
declare b public.bank_entries; m public.bank_entries;
begin
  if TG_OP = 'DELETE' then raise exception 'El historial no se borra. Revierte la conciliación.'; end if;
  if TG_OP = 'UPDATE' then
    if OLD.reversed_at is not null or NEW.reversed_at is null or
      (to_jsonb(NEW) - array['reversed_at','reversed_by','reversal_reason']) is distinct from
      (to_jsonb(OLD) - array['reversed_at','reversed_by','reversal_reason']) then
      raise exception 'Solo se permite revertir una conciliación activa con motivo.';
    end if;
    NEW.reversed_at := now();
    return NEW;
  end if;
  if NEW.reversed_at is not null then raise exception 'Una conciliación nueva debe estar activa.'; end if;
  perform id from public.bank_entries where id in (NEW.boxful_id, NEW.mercury_id) order by id for update;
  select * into b from public.bank_entries where id = NEW.boxful_id;
  select * into m from public.bank_entries where id = NEW.mercury_id;
  if b.id is null or m.id is null or b.source <> 'boxful' or m.source <> 'mercury' or
    b.company <> NEW.company or m.company <> NEW.company then
    raise exception 'Selecciona Boxful y Mercury de la misma empresa.';
  end if;
  if b.void_reason is not null or m.void_reason is not null then raise exception 'Un movimiento anulado no se puede conciliar.'; end if;
  if b.version <> NEW.boxful_version or m.version <> NEW.mercury_version then
    raise exception 'Los movimientos cambiaron. Actualiza y revisa los importes.';
  end if;
  if b.amount_cents - m.amount_cents <> NEW.fee_cents then
    raise exception 'No cuadra: Boxful USD debe ser igual a Mercury más comisión.';
  end if;
  NEW.boxful_snapshot := to_jsonb(b);
  NEW.mercury_snapshot := to_jsonb(m);
  NEW.created_at := now();
  return NEW;
end $$;
create trigger bank_guard_match before insert or update or delete on public.bank_matches for each row execute function public.bank_guard_match();

create function public.bank_guard_entry() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then raise exception 'Los movimientos no se borran. Anúlalos con un motivo.'; end if;
  if OLD.void_reason is not null then raise exception 'Un movimiento anulado conserva sus datos originales.'; end if;
  if exists (select 1 from public.bank_matches where reversed_at is null and (boxful_id = OLD.id or mercury_id = OLD.id)) then
    raise exception 'Revierte la conciliación antes de modificar o anular el movimiento.';
  end if;
  if NEW.id <> OLD.id or NEW.company <> OLD.company or NEW.source <> OLD.source or NEW.created_by <> OLD.created_by or NEW.created_at <> OLD.created_at or
    NEW.document_path is distinct from OLD.document_path or NEW.document_name is distinct from OLD.document_name or NEW.document_sha256 is distinct from OLD.document_sha256 then
    raise exception 'No se puede cambiar la empresa, el origen ni el PDF de un registro.';
  end if;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  return NEW;
end $$;
create trigger bank_guard_entry before update or delete on public.bank_entries for each row execute function public.bank_guard_entry();

create function public.bank_write_audit() returns trigger language plpgsql security invoker set search_path = '' as $$
declare actor uuid; op text;
begin
  if TG_TABLE_NAME = 'bank_entries' then
    actor := NEW.updated_by;
    op := case when TG_OP = 'INSERT' then 'registered' when NEW.void_reason is not null then 'voided' else 'edited' end;
  else
    actor := coalesce(NEW.reversed_by, NEW.created_by);
    op := case when TG_OP = 'INSERT' then 'reconciled' else 'reversed' end;
  end if;
  insert into public.bank_audit(company, entity_id, entity_type, operation, actor_id, snapshot)
  values (NEW.company, NEW.id, TG_TABLE_NAME, op, actor, to_jsonb(NEW));
  return NEW;
end $$;
create trigger bank_audit_entry after insert or update on public.bank_entries for each row execute function public.bank_write_audit();
create trigger bank_audit_match after insert or update on public.bank_matches for each row execute function public.bank_write_audit();

alter table public.bank_entries enable row level security;
alter table public.bank_matches enable row level security;
alter table public.bank_audit enable row level security;
revoke all on public.bank_entries, public.bank_matches, public.bank_audit from anon, authenticated;
revoke all on public.bank_entries, public.bank_matches, public.bank_audit from service_role;
grant select, insert, update on public.bank_entries, public.bank_matches to service_role;
grant select, insert on public.bank_audit to service_role;
revoke execute on function public.bank_guard_match(), public.bank_guard_entry(), public.bank_write_audit() from public, anon, authenticated;
grant execute on function public.bank_guard_match(), public.bank_guard_entry(), public.bank_write_audit() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('bank-documents','bank-documents',false,15728640,array['application/pdf']);
