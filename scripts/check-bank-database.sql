-- Execute inside BEGIN / ROLLBACK, after the migration. All rows are synthetic.
create function pg_temp.expect_bank_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if SQLERRM not like '%' || expected || '%' then raise exception 'Unexpected error: % (expected %)', SQLERRM, expected; end if;
    return;
  end;
  raise exception 'Expected rejection: %', statement;
end $$;

insert into public.bank_entries(id,company,source,reference,occurred_on,amount_cents,original_currency,original_amount_cents,counterparty,bank_account,document_path,document_name,document_sha256,created_by,updated_by) values
('f9000000-0000-4000-8000-000000000001','miranova','boxful','QA-B1','2026-10-28',100000,'GTQ',775000,'Boxful QA','','qa/1.pdf','qa.pdf',repeat('a',64),'f9000000-0000-4000-8000-000000000099','f9000000-0000-4000-8000-000000000099'),
('f9000000-0000-4000-8000-000000000002','miranova','mercury','QA-M1','2026-10-28',99750,'USD',99750,'Boxful QA','Checking QA',null,null,null,'f9000000-0000-4000-8000-000000000099','f9000000-0000-4000-8000-000000000099'),
('f9000000-0000-4000-8000-000000000003','miranova','boxful','QA-B2','2026-10-28',100000,'USD',100000,'Boxful QA','','qa/2.pdf','qa2.pdf',repeat('b',64),'f9000000-0000-4000-8000-000000000099','f9000000-0000-4000-8000-000000000099'),
('f9000000-0000-4000-8000-000000000004','miranova','mercury','QA-M2','2026-10-28',99750,'USD',99750,'Boxful QA','Checking QA',null,null,null,'f9000000-0000-4000-8000-000000000099','f9000000-0000-4000-8000-000000000099'),
('f9000000-0000-4000-8000-000000000005','mireva','mercury','QA-M3','2026-10-28',99750,'USD',99750,'Boxful QA','Checking QA',null,null,null,'f9000000-0000-4000-8000-000000000099','f9000000-0000-4000-8000-000000000099');

do $$
declare ins text := $q$insert into public.bank_matches(company,boxful_id,mercury_id,boxful_version,mercury_version,fee_cents,fee_note,created_by) values ('miranova','f9000000-0000-4000-8000-000000000001','f9000000-0000-4000-8000-000000000002',1,1,250,'Wire fee QA','f9000000-0000-4000-8000-000000000099')$q$;
begin
  perform pg_temp.expect_bank_error(replace(ins, ',250,', ',249,'), 'No cuadra');
  perform pg_temp.expect_bank_error(replace(ins, ',250,', ',-250,'), 'No cuadra');
  perform pg_temp.expect_bank_error(replace(ins, ',1,1,', ',2,1,'), 'cambiaron');
  perform pg_temp.expect_bank_error(replace(ins, '000000000002', '000000000005'), 'misma empresa');
  perform pg_temp.expect_bank_error(replace(ins, '000000000001', '000000000004'), 'misma empresa');
  perform pg_temp.expect_bank_error(replace(ins, 'Wire fee QA', ''), 'check constraint');
  execute ins;
  perform pg_temp.expect_bank_error(replace(ins, '000000000002', '000000000004'), 'bank_matches_boxful_active');
  perform pg_temp.expect_bank_error(replace(ins, '000000000001', '000000000003'), 'bank_matches_mercury_active');
end $$;

select pg_temp.expect_bank_error($q$update public.bank_entries set amount_cents=99999 where id='f9000000-0000-4000-8000-000000000001'$q$, 'Revierte');
select pg_temp.expect_bank_error($q$update public.bank_entries set void_reason='error QA' where id='f9000000-0000-4000-8000-000000000002'$q$, 'Revierte');
select pg_temp.expect_bank_error($q$delete from public.bank_entries where id='f9000000-0000-4000-8000-000000000003'$q$, 'no se borran');
select pg_temp.expect_bank_error($q$update public.bank_matches set fee_note='changed' where boxful_id='f9000000-0000-4000-8000-000000000001'$q$, 'Solo se permite');
select pg_temp.expect_bank_error($q$update public.bank_matches set reversed_at=now(),reversed_by=created_by where boxful_id='f9000000-0000-4000-8000-000000000001'$q$, 'check constraint');
select pg_temp.expect_bank_error($q$update public.bank_entries set reference=' qa-b1 ' where id='f9000000-0000-4000-8000-000000000003'$q$, 'bank_entries_company_source_reference_key_key');
select pg_temp.expect_bank_error($q$insert into public.bank_entries(company,source,reference,occurred_on,amount_cents,original_currency,original_amount_cents,document_path,document_name,document_sha256,created_by,updated_by) values ('miranova','boxful','QA duplicate PDF','2026-10-28',1,'USD',1,'qa/copy.pdf','copy.pdf',repeat('a',64),'f9000000-0000-4000-8000-000000000099','f9000000-0000-4000-8000-000000000099')$q$, 'bank_entries_pdf_unique');
select pg_temp.expect_bank_error($q$insert into public.bank_entries(company,source,reference,occurred_on,amount_cents,original_currency,original_amount_cents,document_path,document_name,document_sha256,created_by,updated_by) values ('miranova','boxful','QA missing hash','2026-10-28',1,'USD',1,'qa/copy.pdf','copy.pdf',null,'f9000000-0000-4000-8000-000000000099','f9000000-0000-4000-8000-000000000099')$q$, 'check constraint');

-- Revertir conserva el cruce, libera ambos movimientos y permite corregirlos.
update public.bank_matches set reversed_at=now(), reversed_by=created_by, reversal_reason='QA: transferencia incorrecta' where boxful_id='f9000000-0000-4000-8000-000000000001';
update public.bank_entries set amount_cents=100001 where id='f9000000-0000-4000-8000-000000000001';
select pg_temp.expect_bank_error($q$update public.bank_matches set reversal_reason='otro' where boxful_id='f9000000-0000-4000-8000-000000000001'$q$, 'Solo se permite');
update public.bank_entries set void_reason='QA error' where id='f9000000-0000-4000-8000-000000000003';
select pg_temp.expect_bank_error($q$update public.bank_entries set notes='changed' where id='f9000000-0000-4000-8000-000000000003'$q$, 'anulado');
select pg_temp.expect_bank_error($q$insert into public.bank_matches(company,boxful_id,mercury_id,boxful_version,mercury_version,fee_cents,fee_note,created_by) values ('miranova','f9000000-0000-4000-8000-000000000003','f9000000-0000-4000-8000-000000000004',2,1,250,'QA','f9000000-0000-4000-8000-000000000099')$q$, 'anulado');

do $$
begin
  if (select (boxful_snapshot->>'amount_cents')::bigint from public.bank_matches where boxful_id='f9000000-0000-4000-8000-000000000001') <> 100000 then raise exception 'Historical snapshot changed'; end if;
  if (select version from public.bank_entries where id='f9000000-0000-4000-8000-000000000001') <> 2 then raise exception 'Version did not increment'; end if;
  if (select count(*) from public.bank_audit where actor_id='f9000000-0000-4000-8000-000000000099') <> 9 then raise exception 'Missing audit events'; end if;
  if has_table_privilege('anon','public.bank_entries','SELECT') or has_table_privilege('authenticated','public.bank_matches','INSERT') then raise exception 'Public financial access'; end if;
  if has_table_privilege('service_role','public.bank_audit','UPDATE') or has_table_privilege('service_role','public.bank_audit','DELETE') then raise exception 'Mutable audit grants'; end if;
end $$;

set local role service_role;
-- El servidor también debe poder ejecutar los triggers de auditoría con su rol real.
update public.bank_entries set notes='QA service role' where id='f9000000-0000-4000-8000-000000000004';
reset role;
select 'PASS: exact cents, 1:1 uniqueness, companies, versions, reversal, audit, RLS and service role' as result;

-- Clasificar un abono nuevo conserva sus datos y su ID; un historial previo impide moverlo.
update public.bank_entries set company='mireva',notes='QA empresa confirmada' where id='f9000000-0000-4000-8000-000000000004';
do $$ begin
  if not exists(select 1 from public.bank_entries where id='f9000000-0000-4000-8000-000000000004' and company='mireva' and amount_cents=99750 and reference='QA-M2') then raise exception 'Move changed original transaction'; end if;
  if not exists(select 1 from public.bank_audit where entity_id='f9000000-0000-4000-8000-000000000004' and company='mireva' and operation='edited') then raise exception 'Move missing audit'; end if;
end $$;
update public.bank_entries set company='miranova' where id='f9000000-0000-4000-8000-000000000004';
select pg_temp.expect_bank_error($q$update public.bank_entries set company='mireva' where id='f9000000-0000-4000-8000-000000000002'$q$, 'sin historial');
select pg_temp.expect_bank_error($q$update public.bank_entries set company='mireva' where id='f9000000-0000-4000-8000-000000000001'$q$, 'sin historial');
insert into public.bank_entries(company,source,reference,occurred_on,amount_cents,original_currency,original_amount_cents,counterparty,bank_account,created_by,updated_by) values
('mireva','mercury','QA-M2','2026-10-28',99750,'USD',99750,'QA','Checking QA','f9000000-0000-4000-8000-000000000099','f9000000-0000-4000-8000-000000000099');
select pg_temp.expect_bank_error($q$update public.bank_entries set company='mireva' where id='f9000000-0000-4000-8000-000000000004'$q$, 'bank_entries_company_source_reference_key_key');
select 'PASS: Mercury move preserves identity, amounts, audit, destination uniqueness and reconciliation history' as result;
