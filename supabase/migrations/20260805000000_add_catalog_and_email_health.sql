alter table public.order_notifications
  add column if not exists resend_last_event text not null default '';

alter table public.order_notifications
  add column if not exists delivery_checked_at timestamptz;

alter table public.order_notifications
  add column if not exists delivery_error text not null default '';

alter table public.catalog_guest_links
  add column if not exists link_token_ciphertext text not null default '';
