create table if not exists public.price_access_notifications (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  recipients text[] not null default '{}',
  resend_email_id text not null default '',
  last_error text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.price_access_notifications enable row level security;

drop policy if exists "price access notifications admin select" on public.price_access_notifications;
create policy "price access notifications admin select"
on public.price_access_notifications for select
to authenticated
using (public.is_admin());

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_new_price_access_request()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  internal_secret text;
begin
  select decrypted_secret
  into internal_secret
  from vault.decrypted_secrets
  where name = 'price_access_notification_secret'
  order by created_at desc
  limit 1;

  if coalesce(internal_secret, '') <> '' then
    perform net.http_post(
      url := 'https://iexpvwmtxauvzkcncqoc.supabase.co/functions/v1/send-price-access-request',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-price-access-secret', internal_secret
      ),
      body := jsonb_build_object('profile_id', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_new_price_access_request on public.profiles;
create trigger notify_new_price_access_request
after insert on public.profiles
for each row
when (new.role::text = 'customer' and new.price_access_approved = false)
execute function public.notify_new_price_access_request();
