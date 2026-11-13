-- Boxful (solo liquidaciones de Conciliación) como plataforma de una cuenta.
set local lock_timeout = '5s';

alter table public.accounts drop constraint if exists accounts_platform_check;
alter table public.accounts add constraint accounts_platform_check check (platform in ('soydrop', 'dropi', 'boxful'));
