-- Contactos de las tiendas: grupo de WhatsApp de soporte, teléfono y responsable del dueño.
-- Un contacto puede atender varias operaciones (la misma tienda en varios países o plataformas),
-- así que las tiendas se vinculan a un contacto en vez de guardar el enlace en cada una.
-- El grupo (por su código de invitación) y el teléfono son únicos: pegar el mismo grupo o el
-- mismo teléfono en otra tienda la suma al contacto existente en vez de duplicarlo.
create table if not exists public.store_contacts (
  id uuid primary key default gen_random_uuid(),
  whatsapp_group_url text,           -- https://chat.whatsapp.com/<código>
  whatsapp_group_code text unique,   -- el <código>, para reconocer el mismo grupo
  owner_name text,                   -- responsable (por defecto, el que informa la plataforma)
  owner_phone text unique,           -- solo dígitos, con código de país (50499998888)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tienda (cuenta + store_id, igual que en order_facts) → contacto. Una tienda tiene un solo contacto.
create table if not exists public.store_contact_links (
  account_id uuid not null references public.accounts(id) on delete cascade,
  store_id text not null,
  contact_id uuid not null references public.store_contacts(id) on delete cascade,
  store_name text,                   -- nombre al vincular, para listados sin unir pedidos
  created_at timestamptz not null default now(),
  primary key (account_id, store_id)
);

create index if not exists store_contact_links_contact_idx on public.store_contact_links (contact_id);

-- Solo el backend (service role) las lee y escribe: RLS activo y sin políticas.
alter table public.store_contacts enable row level security;
alter table public.store_contact_links enable row level security;
revoke all on public.store_contacts from anon, authenticated;
revoke all on public.store_contact_links from anon, authenticated;

-- Directorio de tiendas de todas las cuentas, para sugerir vínculos entre operaciones:
-- nombre y responsable más recientes (Drop: seller.name = tienda, seller.lastName = persona).
create or replace function public.store_directory()
returns table (
  account_id uuid, store_id text, account_name text, country text, name text, person text,
  last_at timestamptz, orders90 bigint
)
language sql stable as $$
  select o.account_id,
    coalesce(o.raw->'seller'->>'sellerId', o.raw->'user'->>'id', 'name:' || o.dropshipper) as store_id,
    max(a.name), max(a.country),
    (array_agg(o.dropshipper order by o.ordered_at desc))[1],
    (array_agg(btrim(regexp_replace(o.raw->'seller'->>'lastName', '\s+', ' ', 'g')) order by o.ordered_at desc)
      filter (where nullif(btrim(o.raw->'seller'->>'lastName'), '') is not null))[1],
    max(o.ordered_at),
    count(*) filter (where o.ordered_at >= now() - interval '90 days' and public.status_group(o.status_code) is distinct from 'cancelled')
  from public.orders o
  join public.accounts a on a.id = o.account_id
  where o.dropshipper is not null
  group by 1, 2
$$;

revoke all on function public.store_directory() from public, anon, authenticated;
grant execute on function public.store_directory() to service_role;
