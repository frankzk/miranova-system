-- Recolecta por cuenta, separada del traslado y de la recolección común en GT.
-- Los importes existentes se conservan; una recolecta sin registrar suma cero.
set local lock_timeout = '5s';
alter table public.profit_markets
  add column if not exists collection_cost numeric(12,4) check (collection_cost >= 0),
  add column if not exists collection_currency text check (collection_currency in ('USD','GTQ','HNL'));
