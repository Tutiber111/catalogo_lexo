alter table public.product_overrides
add column if not exists out_of_stock boolean not null default false;
