alter table public.order_notifications
add column if not exists resend_email_id text not null default '';

alter table public.order_notifications
add column if not exists resend_to text not null default '';
