create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists client_request_id uuid;

alter table public.orders
  add column if not exists client_request_hash text not null default '';

alter table public.order_items
  add column if not exists client_line_number integer;

create unique index if not exists orders_client_request_id_unique
on public.orders (client_request_id)
where client_request_id is not null;

create unique index if not exists order_items_client_line_unique
on public.order_items (order_id, client_line_number)
where client_line_number is not null;

create table if not exists public.erp_order_exports (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry-scheduled', 'synced', 'dead-letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  erp_order_id uuid,
  erp_order_number text not null default '',
  last_error text not null default '',
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_order_exports_work_idx
on public.erp_order_exports (status, next_attempt_at, created_at);

alter table public.erp_order_exports enable row level security;

drop policy if exists "erp order exports admin select" on public.erp_order_exports;
create policy "erp order exports admin select"
on public.erp_order_exports for select
to authenticated
using (public.is_admin());

create or replace function public.queue_order_for_erp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.erp_order_exports (order_id)
  values (new.order_id)
  on conflict (order_id) do nothing;
  return new;
end;
$$;

drop trigger if exists queue_order_for_erp_after_notification on public.order_notifications;
create trigger queue_order_for_erp_after_notification
after insert on public.order_notifications
for each row execute function public.queue_order_for_erp();

create or replace function public.claim_erp_order_exports(p_limit integer default 10)
returns table (
  export_id uuid,
  order_id uuid,
  lease_token uuid,
  payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select queue.id
    from public.erp_order_exports queue
    where (
      (
        queue.status in ('pending', 'retry-scheduled')
        and queue.next_attempt_at <= now()
      ) or (
        queue.status = 'processing'
        and queue.lease_expires_at < now()
      )
    )
    and exists (
      select 1
      from public.order_items items
      where items.order_id = queue.order_id
    )
    order by queue.created_at, queue.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
  ), claimed as (
    update public.erp_order_exports queue
    set
      status = 'processing',
      attempt_count = queue.attempt_count + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
    from candidates
    where queue.id = candidates.id
    returning queue.*
  )
  select
    claimed.id,
    claimed.order_id,
    claimed.lease_token,
    jsonb_build_object(
      'sourceSystem', 'lexo-catalog',
      'externalOrderId', orders.id,
      'externalOrderNumber', orders.order_number,
      'externalCreatedAt', orders.created_at,
      'clientRequestId', orders.client_request_id,
      'clientRequestHash', orders.client_request_hash,
      'clientCode', coalesce(nullif(orders.sales_client_code, ''), nullif(orders.customer_client_code, '')),
      'clientNameSnapshot', coalesce(nullif(orders.sales_client_name, ''), orders.customer_name),
      'address', orders.sales_client_address,
      'locality', orders.sales_client_locality,
      'transport', orders.order_transport,
      'observations', orders.notes,
      'salesmanCodeSnapshot', orders.salesman_code,
      'totalItemsSnapshot', orders.total_items,
      'totalValueSnapshot', orders.total_value,
      'lines', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'externalLineId', items.id,
            'lineNumber', items.client_line_number,
            'sku', items.sku,
            'productNameSnapshot', items.name,
            'quantity', items.quantity,
            'unitPrice', items.unit_price,
            'lineTotalSnapshot', items.line_total
          )
          order by items.client_line_number nulls last, items.created_at, items.id
        )
        from public.order_items items
        where items.order_id = orders.id
      ), '[]'::jsonb)
    )
  from claimed
  join public.orders orders on orders.id = claimed.order_id
  where exists (
    select 1 from public.order_items items where items.order_id = orders.id
  );
end;
$$;

create or replace function public.ack_erp_order_export(
  p_order_id uuid,
  p_lease_token uuid,
  p_erp_order_id uuid,
  p_erp_order_number text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.erp_order_exports
  set
    status = 'synced',
    erp_order_id = p_erp_order_id,
    erp_order_number = left(coalesce(p_erp_order_number, ''), 120),
    last_error = '',
    synced_at = now(),
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
  where order_id = p_order_id
    and status = 'processing'
    and lease_token = p_lease_token;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.fail_erp_order_export(
  p_order_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.erp_order_exports
  set
    status = case
      when p_retryable and attempt_count < 8 then 'retry-scheduled'
      else 'dead-letter'
    end,
    next_attempt_at = case
      when p_retryable and attempt_count < 8
        then now() + least(interval '6 hours', interval '30 seconds' * power(2, greatest(attempt_count - 1, 0)))
      else next_attempt_at
    end,
    last_error = left(coalesce(p_error, 'Unknown ERP synchronization error.'), 2000),
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
  where order_id = p_order_id
    and status = 'processing'
    and lease_token = p_lease_token;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.claim_erp_order_exports(integer) from public, anon, authenticated;
revoke all on function public.ack_erp_order_export(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_erp_order_export(uuid, uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.claim_erp_order_exports(integer) to service_role;
grant execute on function public.ack_erp_order_export(uuid, uuid, uuid, text) to service_role;
grant execute on function public.fail_erp_order_export(uuid, uuid, text, boolean) to service_role;
