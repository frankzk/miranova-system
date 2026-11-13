-- Liquidaciones: lo que la plataforma (Drop; luego Boxful) registra como liquidación, para conciliarla en 3 pasos:
-- ① la liquidación → ② el PDF de la transferencia (bank_entries de Boxful) → ③ el abono Mercury (bank_matches).
-- Las trae la sincronización (solo lectura en la plataforma). El vínculo con el PDF y la revisión de las
-- rechazadas los confirma una persona y quedan en la auditoría de conciliación (bank_audit).

set local lock_timeout = '5s';

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('miranova', 'mireva')),
  source text not null check (source in ('drop', 'boxful')),
  account_id uuid references public.accounts(id) on delete set null,
  external_id text not null check (length(external_id) between 1 and 200),
  reference text not null default '' check (length(reference) <= 400),
  -- número de confirmación de la transferencia (la referencia del PDF de Boxful/BAC)
  confirmation text not null default '' check (length(confirmation) <= 100),
  operation text check (operation in ('miranova', 'mireva')),
  country text check (country in ('HN', 'GT', 'SV', 'CR')),
  requested_at timestamptz not null,
  requested_on date not null, -- el día en el país de la cuenta (como lo muestra la plataforma)
  status text not null check (status in ('pending', 'paid', 'rejected')),
  status_label text not null default '' check (length(status_label) <= 80),
  failure_reason text not null default '' check (length(failure_reason) <= 300),
  currency text not null check (currency in ('USD','HNL','GTQ','MXN','CRC','NIO','COP','EUR')),
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  usd_rate numeric check (usd_rate is null or usd_rate > 0),
  usd_amount_cents bigint check (usd_amount_cents is null or usd_amount_cents > 0), -- si la plataforma informa lo enviado en USD
  bank text not null default '' check (length(bank) <= 200),
  bank_account text not null default '' check (length(bank_account) <= 100),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- paso 2: el PDF, lo confirma una persona
  boxful_id uuid,
  linked_by uuid,
  linked_at timestamptz,
  -- rechazadas: alguien las revisó
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(btrim(review_note)) between 3 and 500),
  -- quién hizo el último cambio de vínculo o revisión (para la auditoría)
  changed_by uuid,
  unique (source, external_id),
  foreign key (company, boxful_id) references public.bank_entries(company, id),
  check ((boxful_id is null) = (linked_by is null) and (boxful_id is null) = (linked_at is null)),
  check ((reviewed_at is null) = (reviewed_by is null))
);
create index settlements_account_pending on public.settlements(account_id, requested_at) where status = 'pending';
create unique index settlements_boxful_unique on public.settlements(boxful_id) where boxful_id is not null;
create index settlements_company_requested on public.settlements(company, requested_at desc);

-- Cuándo se leyeron por última vez las liquidaciones de cada cuenta (null: falta la primera lectura completa).
alter table public.accounts
  add column if not exists settlements_sync_at timestamptz,
  add column if not exists settlements_msg text,
  -- primera lectura completa a medias: desde qué página sigue (null: no hay nada pendiente)
  add column if not exists settlements_resume_page integer check (settlements_resume_page is null or settlements_resume_page > 1);
-- el diagnóstico de solo lectura que sirvió para encontrarlas ya no hace falta
update public.accounts set debug = debug - 'settlement_probe' where debug ? 'settlement_probe';

-- Comprobantes de Boxful que no son una liquidación (p. ej. un pago de bodega): salen de las sugerencias.
create table public.settlement_exempt_entries (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  company text not null check (company in ('miranova', 'mireva')),
  reason text not null check (length(btrim(reason)) between 3 and 300),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz,
  foreign key (company, entry_id) references public.bank_entries(company, id),
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index settlement_exempt_active on public.settlement_exempt_entries(entry_id) where revoked_at is null;

-- Vincular solo un PDF de Boxful vigente, de la misma empresa y no marcado "no es liquidación". Cada vínculo
-- o revisión dice quién lo hizo (changed_by, igual a linked_by / reviewed_by) y queda en bank_audit; después
-- changed_by vuelve a null, así el próximo cambio tiene que decirlo otra vez. La sincronización no toca nada de esto.
create function public.settlement_guard() returns trigger language plpgsql security invoker set search_path = '' as $$
declare e public.bank_entries; op text;
begin
  if TG_OP = 'DELETE' then raise exception 'Las liquidaciones no se borran.'; end if;
  if TG_OP = 'INSERT' then
    if NEW.boxful_id is not null or NEW.reviewed_at is not null then
      raise exception 'Una liquidación llega sin comprobante ni revisión: eso lo confirma una persona.';
    end if;
    NEW.changed_by := null;
    return NEW;
  end if;
  if NEW.boxful_id is distinct from OLD.boxful_id then
    op := case when NEW.boxful_id is null then 'unlinked' else 'linked' end;
  elsif NEW.reviewed_at is distinct from OLD.reviewed_at or NEW.review_note is distinct from OLD.review_note then
    op := case when NEW.reviewed_at is null then 'unreviewed' else 'reviewed' end;
  end if;
  if op is null then
    NEW.changed_by := null; -- la sincronización: datos de la plataforma
    return NEW;
  end if;
  if NEW.changed_by is null then raise exception 'Falta quién hizo el cambio.'; end if;
  if op = 'linked' then
    if NEW.linked_by is distinct from NEW.changed_by then raise exception 'El vínculo debe llevar a quien lo hizo.'; end if;
    -- bloquea el comprobante: vincularlo y marcarlo "no es liquidación" no pueden cruzarse
    select * into e from public.bank_entries where id = NEW.boxful_id for no key update;
    if e.id is null or e.source <> 'boxful' or e.company <> NEW.company then
      raise exception 'Elige un comprobante de Boxful de la misma empresa.';
    end if;
    if e.void_reason is not null then raise exception 'Ese comprobante está anulado.'; end if;
    if exists (select 1 from public.settlement_exempt_entries where entry_id = NEW.boxful_id and revoked_at is null) then
      raise exception 'Ese comprobante está marcado como «no es liquidación».';
    end if;
  elsif op = 'reviewed' and NEW.reviewed_by is distinct from NEW.changed_by then
    raise exception 'La revisión debe llevar a quien la hizo.';
  end if;
  insert into public.bank_audit(company, entity_id, entity_type, operation, actor_id, snapshot)
  values (NEW.company, NEW.id, 'settlements', op, NEW.changed_by, to_jsonb(NEW) - 'raw' - 'changed_by');
  NEW.changed_by := null;
  return NEW;
end $$;
create trigger settlement_guard before insert or update or delete on public.settlements for each row execute function public.settlement_guard();

-- Las marcas "no es liquidación" no se borran (se deshacen con autor) y no van en un comprobante ya vinculado.
create function public.settlement_exempt_guard() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then raise exception 'Las marcas no se borran: se deshacen.'; end if;
  if TG_OP = 'UPDATE' then
    if OLD.revoked_at is not null or NEW.revoked_at is null or
      (to_jsonb(NEW) - array['revoked_at', 'revoked_by']) is distinct from (to_jsonb(OLD) - array['revoked_at', 'revoked_by']) then
      raise exception 'Solo se puede deshacer una marca vigente, con autor.';
    end if;
    return NEW;
  end if;
  if NEW.revoked_at is not null then raise exception 'Una marca nueva debe estar vigente.'; end if;
  perform 1 from public.bank_entries where id = NEW.entry_id for no key update;
  if not exists (select 1 from public.bank_entries where id = NEW.entry_id and source = 'boxful' and company = NEW.company) then
    raise exception 'Elige un comprobante de Boxful de esta empresa.';
  end if;
  if exists (select 1 from public.settlements where boxful_id = NEW.entry_id) then
    raise exception 'Ese comprobante está vinculado a una liquidación. Desvincúlalo primero.';
  end if;
  return NEW;
end $$;
create trigger settlement_exempt_guard before insert or update or delete on public.settlement_exempt_entries for each row execute function public.settlement_exempt_guard();

create function public.settlement_exempt_audit() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.bank_audit(company, entity_id, entity_type, operation, actor_id, snapshot)
  values (NEW.company, NEW.entry_id, 'settlement_exempt_entries',
    case when TG_OP = 'INSERT' then 'exempted' else 'unexempted' end,
    case when TG_OP = 'INSERT' then NEW.created_by else NEW.revoked_by end, to_jsonb(NEW));
  return NEW;
end $$;
create trigger settlement_exempt_audit after insert or update on public.settlement_exempt_entries for each row execute function public.settlement_exempt_audit();

alter table public.settlements enable row level security;
alter table public.settlement_exempt_entries enable row level security;
revoke all on public.settlements, public.settlement_exempt_entries from anon, authenticated, service_role;
grant select, insert, update on public.settlements, public.settlement_exempt_entries to service_role;
revoke execute on function public.settlement_guard(), public.settlement_exempt_guard(), public.settlement_exempt_audit() from public, anon, authenticated;
grant execute on function public.settlement_guard(), public.settlement_exempt_guard(), public.settlement_exempt_audit() to service_role;
