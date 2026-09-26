-- Seguimiento comercial de tiendas (CRM interno de Miranova): quién contactó a la tienda,
-- cuándo, qué se recomendó, qué se hizo y cuándo volver a revisarla. La tienda se
-- identifica igual que en order_facts (store_id = ID del vendedor o "name:<nombre>");
-- store_name guarda el nombre al momento del registro para listados sin unir pedidos.
create table if not exists public.store_followups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id text not null,
  store_name text,
  owner text,
  contacted_at date not null default current_date,
  recommendation text,
  action_taken text,
  status text not null default 'pendiente' check (status in ('pendiente', 'en_curso', 'hecho', 'sin_respuesta')),
  next_followup date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists store_followups_store_idx on public.store_followups (account_id, store_id);

-- Solo el backend (service role) la lee y escribe: RLS activo y sin políticas.
alter table public.store_followups enable row level security;
revoke all on public.store_followups from anon, authenticated;
