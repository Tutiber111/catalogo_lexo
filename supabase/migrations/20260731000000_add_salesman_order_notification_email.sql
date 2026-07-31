alter table public.profiles
add column if not exists order_notification_email text not null default '';

update public.profiles
set order_notification_email = coalesce(email, '')
where role::text = 'salesman'
  and coalesce(order_notification_email, '') = ''
  and coalesce(email, '') <> '';
