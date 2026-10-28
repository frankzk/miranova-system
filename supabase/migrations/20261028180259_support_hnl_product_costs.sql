-- Add HNL without changing existing USD / GTQ records or permissions.
set local lock_timeout = '5s';

alter table public.profit_products
  add column if not exists fx_hnl_per_usd numeric(10, 4)
  check (fx_hnl_per_usd > 0);

alter table public.profit_products drop constraint if exists profit_products_cost_currency_check;
alter table public.profit_products add constraint profit_products_cost_currency_check
  check (cost_currency in ('USD', 'GTQ', 'HNL'));

alter table public.profit_products drop constraint if exists profit_products_hnl_rate_required;
alter table public.profit_products add constraint profit_products_hnl_rate_required
  check (cost_currency <> 'HNL' or (fx_hnl_per_usd is not null and fx_hnl_per_usd > 0));

comment on column public.profit_products.fx_hnl_per_usd is
  'Lempiras per USD used for this cost sheet. Independent of the GTQ exchange rate.';
