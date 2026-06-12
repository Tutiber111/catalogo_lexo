alter table public.orders
  add column if not exists order_transport text not null default '';
