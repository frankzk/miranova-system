-- Importaciones (fase 3): proveedores guardados, cada uno con su origen y datos de contacto, para
-- elegirlos al crear una importación en vez de escribirlos cada vez.

create table if not exists public.import_suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  origin        text,                 -- país o ciudad (China, Yiwu…)
  contact       text,                 -- persona de contacto
  whatsapp      text,
  email         text,
  payment_terms text,                 -- "30 % anticipo, 70 % antes de enviar"
  notes         text,
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists import_suppliers_name_key on public.import_suppliers (lower(name));
alter table public.import_suppliers enable row level security;

-- la importación guarda el proveedor elegido (y su nombre, como antes, para listas e historial)
alter table public.imports add column if not exists supplier_id uuid references public.import_suppliers(id) on delete set null;
create index if not exists imports_supplier_idx on public.imports (supplier_id);

-- los proveedores escritos a mano hasta ahora pasan a ser proveedores guardados (con el origen más usado)
insert into public.import_suppliers (name, origin)
select distinct on (lower(trim(supplier))) trim(supplier), origin
from (
  select supplier, origin, count(*) over (partition by lower(trim(supplier)), origin) as n
  from public.imports
  where supplier is not null and trim(supplier) <> ''
) s
order by lower(trim(supplier)), n desc, origin
on conflict do nothing;

update public.imports i
set supplier_id = s.id
from public.import_suppliers s
where i.supplier_id is null and i.supplier is not null and lower(trim(i.supplier)) = lower(s.name);
