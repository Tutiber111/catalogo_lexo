create table if not exists public.price_access_approval_notifications (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  email_payload jsonb,
  resend_email_id text not null default '',
  last_error text not null default '',
  first_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.price_access_approval_notifications enable row level security;
revoke all on public.price_access_approval_notifications from public, anon, authenticated;
grant select on public.price_access_approval_notifications to authenticated;
grant all on public.price_access_approval_notifications to service_role;

drop policy if exists "approval notifications admin select" on public.price_access_approval_notifications;
create policy "approval notifications admin select"
on public.price_access_approval_notifications for select
to authenticated
using ((select public.is_admin()));

create index if not exists price_access_approval_notifications_pending_idx
on public.price_access_approval_notifications (created_at)
where status in ('pending', 'failed', 'processing') and attempts < 5;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists private;

-- Internal functions are not exposed as RPCs; only triggers and the postgres cron job call them.
create or replace function private.dispatch_price_access_approval_notifications(p_profile_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal_secret text;
begin
  if not exists (
    select 1 from public.price_access_approval_notifications
    where (p_profile_id is null or profile_id = p_profile_id)
      and attempts < 5
      and (first_attempt_at is null or first_attempt_at > now() - interval '23 hours')
      and (status in ('pending', 'failed')
        or (status = 'processing' and updated_at < now() - interval '5 minutes'))
  ) then
    return;
  end if;

  select decrypted_secret into internal_secret
  from vault.decrypted_secrets
  where name = 'price_access_notification_secret'
  order by created_at desc limit 1;

  if coalesce(internal_secret, '') = '' then
    raise warning 'Approval email queued but the internal notification secret is missing.';
    return;
  end if;

  perform net.http_post(
    url := 'https://iexpvwmtxauvzkcncqoc.supabase.co/functions/v1/send-price-access-approved',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-price-access-secret', internal_secret
    ),
    body := case when p_profile_id is null then '{}'::jsonb
      else jsonb_build_object('profile_id', p_profile_id) end,
    timeout_milliseconds := 60000
  );
exception when others then
  -- Email delivery must not roll back an otherwise valid account approval.
  raise warning 'Approval email dispatch failed; the notification remains queued: %', sqlerrm;
end;
$$;

revoke all on function private.dispatch_price_access_approval_notifications(uuid) from public, anon, authenticated;

create or replace function private.notify_price_access_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.price_access_approval_notifications (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;

  perform private.dispatch_price_access_approval_notifications(new.id);
  return new;
end;
$$;

revoke all on function private.notify_price_access_approved() from public, anon, authenticated;

drop trigger if exists notify_price_access_approved on public.profiles;
create trigger notify_price_access_approved
after update of price_access_approved on public.profiles
for each row
when (
  old.role::text = 'customer'
  and new.role::text = 'customer'
  and old.price_access_approved = false
  and new.price_access_approved = true
)
execute function private.notify_price_access_approved();

-- Do not enqueue already-approved accounts. Only future approval transitions send a welcome email.
select cron.schedule(
  'retry-price-access-approval-notifications',
  '*/5 * * * *',
  $job$
    update public.price_access_approval_notifications
    set status = 'failed',
        last_error = 'Delivery could not be confirmed within the safe retry limit. Review in Resend before retrying.',
        updated_at = now()
    where status = 'processing'
      and updated_at < now() - interval '5 minutes'
      and (attempts >= 5 or first_attempt_at <= now() - interval '23 hours');
    select private.dispatch_price_access_approval_notifications();
  $job$
);
