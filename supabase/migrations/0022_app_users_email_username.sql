-- El usuario puede ser un correo (p. ej. nombre@dominio.com): se permiten "@" y "+" y hasta 80 caracteres.
alter table public.app_users drop constraint if exists app_users_username_check;
alter table public.app_users add constraint app_users_username_check
  check (username = lower(username) and username ~ '^[a-z0-9._+@-]{3,80}$');
