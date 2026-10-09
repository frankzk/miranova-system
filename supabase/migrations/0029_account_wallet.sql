-- Saldo de la billetera de cada cuenta de proveedor (Dinero → Saldo en billeteras).
-- La sincronización descubre la ruta de la billetera en la API de la plataforma
-- (wallet_path) y en cada pasada guarda el saldo leído (wallet_balance, wallet_at).
alter table public.accounts
  add column if not exists wallet_path text,
  add column if not exists wallet_balance numeric,
  add column if not exists wallet_at timestamptz,
  add column if not exists wallet_msg text,
  add column if not exists wallet_probe_at timestamptz;
