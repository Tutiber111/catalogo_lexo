alter table public.order_items
  add column if not exists ean text not null default '';
