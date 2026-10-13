create table public.order_email_failure_alerts (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.order_notifications(id) on delete cascade,
  delivery_key uuid not null unique,
  order_number bigint,
  recipient_email text not null default 'ventas@lexo.com.ar',
  failure_reason text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  email_payload jsonb,
  resend_email_id text not null default '',
  last_error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_email_failure_alerts enable row level security;
revoke all on public.order_email_failure_alerts from public, anon, authenticated;
grant select, insert, update, delete on public.order_email_failure_alerts to service_role;
create index order_email_failure_alerts_pending_idx
  on public.order_email_failure_alerts (created_at)
  where status in ('pending', 'processing', 'failed') and attempts < 5;

-- Queue the first failure for each email generation. Retries do not spam alerts.
create or replace function private.queue_order_email_failure_alert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'failed' then
    insert into public.order_email_failure_alerts (notification_id, delivery_key, order_number, failure_reason)
    select new.id, new.delivery_key, o.order_number,
      left(coalesce(nullif(new.last_error, ''), 'Order email failed without a recorded error.'), 1500)
    from public.orders o where o.id = new.order_id
    on conflict (delivery_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_order_email_failure_alert() from public, anon, authenticated;
create trigger queue_order_email_failure_alert
after insert or update of status on public.order_notifications
for each row execute function private.queue_order_email_failure_alert();

-- A separate watchdog catches hard worker shutdowns, which never run a catch block.
create or replace function private.watch_order_email_failures()
returns void language plpgsql security definer set search_path = '' as $$
declare internal_secret text;
begin
  insert into public.order_email_failure_alerts (notification_id, delivery_key, order_number, failure_reason)
  select n.id, n.delivery_key, o.order_number,
    case when n.status = 'processing' then 'Order email worker has been stuck for more than five minutes.'
      else 'Order email has remained queued for more than five minutes.' end
  from public.order_notifications n join public.orders o on o.id = n.order_id
  where n.status in ('processing', 'pending') and n.updated_at < now() - interval '5 minutes'
    and o.status::text = 'placed'
  on conflict (delivery_key) do nothing;

  if not exists (select 1 from public.order_email_failure_alerts
    where status in ('pending', 'processing', 'failed') and attempts < 5
      and (first_attempt_at is null or first_attempt_at > now() - interval '23 hours')) then return; end if;
  select decrypted_secret into internal_secret from vault.decrypted_secrets
  where name in ('order_notification_secret', 'price_access_notification_secret')
  order by (name = 'order_notification_secret') desc, created_at desc limit 1;
  if coalesce(internal_secret, '') = '' then
    raise warning 'Order email failure alert worker has no internal secret configured.';
    return;
  end if;
  perform net.http_post(
    url := 'https://iexpvwmtxauvzkcncqoc.supabase.co/functions/v1/send-order-email-failure-alerts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-order-notification-secret', internal_secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
end;
$$;
revoke all on function private.watch_order_email_failures() from public, anon, authenticated;
select cron.schedule('watch-order-email-failures', '* * * * *',
  $job$select private.watch_order_email_failures();$job$);
