-- Deploy this migration before the matching send-order-notifications function.
alter table public.order_notifications
  add column if not exists delivery_key uuid not null default gen_random_uuid(),
  add column if not exists first_attempt_at timestamptz;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists private;

create or replace function private.retry_order_email_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal_secret text;
  notification record;
begin
  -- Older sends had no idempotency key. Never automatically replay an ambiguous send.
  update public.order_notifications
  set status = 'failed',
      last_error = 'Email worker stopped. Automatic retry is unsafe or exhausted; review delivery and use admin resend.',
      updated_at = now()
  where status = 'processing'
    and updated_at < now() - interval '5 minutes'
    and (first_attempt_at is null or attempts >= 5
      or first_attempt_at <= now() - interval '23 hours');

  select decrypted_secret into internal_secret
  from vault.decrypted_secrets
  where name in ('order_notification_secret', 'price_access_notification_secret')
  order by (name = 'order_notification_secret') desc, created_at desc
  limit 1;
  if coalesce(internal_secret, '') = '' then
    raise warning 'Order email retry worker has no internal secret configured.';
    return;
  end if;

  -- Each order gets its own CPU budget. Do not drain several attachments in one worker.
  for notification in
    select n.order_id
    from public.order_notifications n
    join public.orders o on o.id = n.order_id
    where o.status::text = 'placed'
      and n.attempts < 5
      and (
        (n.status = 'pending' and n.attempts = 0 and n.updated_at < now() - interval '1 minute')
        or (n.first_attempt_at > now() - interval '23 hours' and (
          (n.status in ('pending', 'failed') and n.updated_at < now() - interval '1 minute')
          or (n.status = 'processing' and n.updated_at < now() - interval '5 minutes')
        ))
      )
    order by n.created_at
    limit 10
  loop
    perform net.http_post(
      url := 'https://iexpvwmtxauvzkcncqoc.supabase.co/functions/v1/send-order-notifications',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-order-notification-secret', internal_secret),
      body := jsonb_build_object('order_id', notification.order_id),
      timeout_milliseconds := 60000
    );
  end loop;
end;
$$;

revoke all on function private.retry_order_email_notifications() from public, anon, authenticated;

select cron.schedule('retry-order-email-notifications', '* * * * *',
  $job$select private.retry_order_email_notifications();$job$);
