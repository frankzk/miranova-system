-- Avisos de "Problemas en gestión" a cada tienda por su grupo de WhatsApp, y llaves para que un asistente
-- (Grok, Claude…) los lea y los marque enviados por MCP (/api/mcp), además de lo que se le habilite.
--   assistant_keys: llaves de acceso de los asistentes; se guarda solo el hash (sha-256) de la llave, y
--     `scopes` dice qué puede ver (lib/assistant-scopes.ts).
--   problem_notice_batches: cada aviso armado para un grupo (pedidos y texto) y cuándo se marcó enviado.
--   problem_notices: último aviso de cada pedido, para no repetirlo y recordarlo cada 3 días.

set lock_timeout = '5s';

create table if not exists public.assistant_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 60),
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  key_tail     text not null,                                   -- últimos 4 caracteres, para reconocerla
  scopes       text[] not null default '{avisos}',              -- qué puede ver: avisos, pedidos, tiendas, traslados
  created_by   uuid references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create table if not exists public.problem_notice_batches (
  id          text primary key,                                 -- hash del grupo, sus pedidos y el día
  group_key   text not null,                                    -- "c:<contacto>" o "s:<cuenta>|<tienda>"
  contact_id  uuid references public.store_contacts(id) on delete set null,
  title       text not null,
  order_ids   uuid[] not null,
  message     text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  sent_via    text check (sent_via in ('mcp', 'panel')),
  sent_by     text                                              -- nombre de la llave o del usuario
);
create index if not exists problem_notice_batches_sent_idx on public.problem_notice_batches (sent_at desc);

create table if not exists public.problem_notices (
  order_id  uuid primary key references public.orders(id) on delete cascade,
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  times     integer not null default 1,
  batch_id  text references public.problem_notice_batches(id) on delete set null
);

-- Solo el backend (service role) accede.
alter table public.assistant_keys          enable row level security;
alter table public.problem_notice_batches  enable row level security;
alter table public.problem_notices         enable row level security;
