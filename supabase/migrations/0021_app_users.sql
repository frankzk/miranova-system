-- Usuarios del panel con usuario y contraseña, y permisos por usuario (casillas por sección).
-- Reemplaza la contraseña única del panel (DASHBOARD_PASSWORD), que queda solo para crear el
-- primer usuario (el dueño) cuando esta tabla está vacía.
--
-- password_hash: scrypt con sal propia ("scrypt$N$r$p$sal$hash", base64). Nunca la contraseña.
-- permissions: claves de lib/permissions.ts (business, orders, stores, stores_edit, products,
--   opportunities, money, export, accounts, users). El dueño (is_owner) tiene todas.
-- session_version: se incrementa al cambiar la contraseña o desactivar el usuario, y cierra
--   todas sus sesiones abiertas (la cookie guarda la versión con la que se firmó).
-- failed_attempts / locked_until: tras varios intentos fallidos el usuario se bloquea unos minutos.
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9._-]{3,40}$'),
  name text not null check (length(btrim(name)) between 1 and 80),
  password_hash text not null,
  permissions text[] not null default '{}',
  is_owner boolean not null default false,
  active boolean not null default true,
  must_change_password boolean not null default false,
  session_version integer not null default 1,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Solo el backend (service role) la lee y escribe: RLS activo y sin políticas.
alter table public.app_users enable row level security;
revoke all on public.app_users from anon, authenticated;
