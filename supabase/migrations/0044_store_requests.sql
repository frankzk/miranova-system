-- Solicitudes de tiendas: lo que las tiendas le piden a Miranova (producto, cantidad y países),
-- para decidir qué importar. Se cargan a mano desde la sección Solicitudes.

set lock_timeout = '5s';

create table if not exists public.store_requests (
  id          uuid primary key default gen_random_uuid(),
  store_name  text not null,
  owner_name  text,
  countries   text[] not null default '{}',   -- códigos de país (HN, GT, SV, CR): puede ser más de uno
  product     text not null,
  quantity    integer not null check (quantity > 0),
  notes       text,
  status      text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'dropped')),
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists store_requests_created_idx on public.store_requests (created_at desc);
alter table public.store_requests enable row level security;

-- quien ya maneja importaciones también ve y carga las solicitudes (con ellas decide qué traer)
update public.app_users
set permissions = array_append(permissions, 'requests')
where 'imports' = any(permissions) and not ('requests' = any(permissions));
