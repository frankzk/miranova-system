-- A shared requested quantity is not a quantity per destination. Keep legacy splits unknown.
set local lock_timeout = '5s';
alter table public.store_request_items
  add column if not exists country_quantities jsonb not null default '{}'::jsonb
  check (jsonb_typeof(country_quantities) = 'object');
comment on column public.store_request_items.country_quantities is
  'Units allocated per destination country for this product. Empty means unallocated; legacy single-country requests can be inferred without duplication.';
