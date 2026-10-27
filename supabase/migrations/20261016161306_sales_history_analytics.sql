-- Historical ERP data is private. Assignment is always resolved through sales_clients.
create table public.sales_history_batches (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  source_name text not null,
  from_date date not null,
  to_date date not null check (to_date >= from_date),
  -- Confirmed business handover; independent of later overlapping export coverage.
  warehouse_from_date date,
  imported_at timestamptz not null default now()
);
create table public.sales_history_lines (
  line_key text primary key,
  order_key text not null,
  order_date date not null,
  client_code text not null,
  client_name text not null default '',
  sku text not null,
  product_name text not null default '',
  locality text not null default '',
  province text not null default '',
  ordered_qty numeric not null,
  invoiced_qty numeric not null,
  delivered_qty numeric not null,
  returned_qty numeric not null,
  cancelled_qty numeric not null,
  pending_qty numeric not null,
  ordered_net numeric not null,
  -- Estimate at the net order-line rate. Source does not contain invoice amounts/dates.
  invoiced_net numeric not null,
  batch_id text not null references public.sales_history_batches(id),
  source_row integer not null check (source_row >= 4)
);
create index sales_history_client_date_idx on public.sales_history_lines (client_code, order_date, line_key);
create index sales_history_date_idx on public.sales_history_lines (order_date, line_key);
alter table public.sales_history_batches enable row level security;
alter table public.sales_history_lines enable row level security;
revoke all on public.sales_history_batches, public.sales_history_lines from anon, authenticated;
grant select on public.sales_history_batches, public.sales_history_lines to authenticated;
grant all on public.sales_history_batches, public.sales_history_lines to service_role;

-- Only authenticated administrators may read historical sales.
create policy "sales history metadata reader" on public.sales_history_batches for select to authenticated
using ((select public.is_admin()));
create policy "sales history current portfolio" on public.sales_history_lines for select to authenticated
using ((select public.is_admin()));
