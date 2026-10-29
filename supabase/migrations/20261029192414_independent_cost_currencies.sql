-- Preserve the original meaning of every existing amount, without converting stored values.
set local lock_timeout = '5s';
alter table public.profit_products
  add column if not exists import_currency text check (import_currency in ('USD','GTQ','HNL')),
  add column if not exists pickup_currency text check (pickup_currency in ('USD','GTQ','HNL'));
alter table public.profit_markets
  add column if not exists transfer_currency text check (transfer_currency in ('USD','GTQ','HNL'));
update public.profit_products set import_currency=cost_currency where import_currency is null;
update public.profit_products set pickup_currency=cost_currency where pickup_currency is null;
update public.profit_markets m set transfer_currency=p.cost_currency
  from public.profit_products p where m.product_id=p.id and m.transfer_currency is null;
