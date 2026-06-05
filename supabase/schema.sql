create extension if not exists pg_trgm;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'customer' check (role::text in ('customer', 'admin', 'salesman')),
  salesman_code text,
  assigned_salesman_code text,
  name text not null default '',
  phone text not null default '',
  company text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salesmen (
  code text primary key,
  name text not null,
  source_label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_clients (
  id uuid primary key default gen_random_uuid(),
  client_code text not null unique,
  name text not null,
  legal_name text not null default '',
  address text not null default '',
  locality text not null default '',
  salesman_code text not null references public.salesmen(code),
  source_salesman_label text not null default '',
  search_text text generated always as (
    lower(
      coalesce(client_code, '') || ' ' ||
      coalesce(name, '') || ' ' ||
      coalesce(legal_name, '') || ' ' ||
      coalesce(address, '') || ' ' ||
      coalesce(locality, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  order_number bigint generated always as identity,
  status text not null default 'placed' check (status in ('placed', 'confirmed', 'packed', 'sent', 'cancelled')),
  customer_name text not null,
  customer_phone text not null default '',
  sales_client_id uuid references public.sales_clients(id) on delete set null,
  sales_client_code text not null default '',
  sales_client_name text not null default '',
  sales_client_address text not null default '',
  sales_client_locality text not null default '',
  salesman_code text not null default '',
  notes text not null default '',
  total_items integer not null default 0,
  total_value numeric(12, 2) not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null,
  sku text not null,
  name text not null,
  unit_price numeric(12, 2) not null,
  quantity integer not null check (quantity > 0),
  line_total numeric(12, 2) not null,
  page integer,
  created_at timestamptz not null default now()
);

create table if not exists public.product_overrides (
  product_id text primary key,
  sku text not null default '',
  name text not null default '',
  category text not null default '',
  price text not null default '',
  hidden boolean not null default false,
  out_of_stock boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  last_error text not null default '',
  resend_email_id text not null default '',
  resend_to text not null default '',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists archived_at timestamptz;
alter table public.product_overrides add column if not exists out_of_stock boolean not null default false;
alter table public.profiles add column if not exists salesman_code text;
alter table public.profiles add column if not exists assigned_salesman_code text;
alter table public.orders add column if not exists sales_client_id uuid references public.sales_clients(id) on delete set null;
alter table public.orders add column if not exists sales_client_code text not null default '';
alter table public.orders add column if not exists sales_client_name text not null default '';
alter table public.orders add column if not exists sales_client_address text not null default '';
alter table public.orders add column if not exists sales_client_locality text not null default '';
alter table public.orders add column if not exists salesman_code text not null default '';
alter table public.order_notifications add column if not exists resend_email_id text not null default '';
alter table public.order_notifications add column if not exists resend_to text not null default '';

do $$
begin
  alter table public.profiles
    drop constraint if exists profiles_role_check;
  alter table public.profiles
    add constraint profiles_role_check check (role::text in ('customer', 'admin', 'salesman'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles
    add constraint profiles_salesman_code_fkey
    foreign key (salesman_code) references public.salesmen(code);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles
    add constraint profiles_assigned_salesman_code_fkey
    foreign key (assigned_salesman_code) references public.salesmen(code);
exception
  when duplicate_object then null;
end $$;

create unique index if not exists profiles_salesman_code_unique
on public.profiles (salesman_code)
where salesman_code is not null and salesman_code <> '';

create index if not exists sales_clients_salesman_code_idx on public.sales_clients (salesman_code);
create index if not exists sales_clients_search_text_idx on public.sales_clients using gin (search_text gin_trgm_ops);

update public.orders
set archived_at = coalesce(archived_at, updated_at, now())
where status = 'sent'
  and archived_at is null;

alter table public.profiles enable row level security;
alter table public.salesmen enable row level security;
alter table public.sales_clients enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.product_overrides enable row level security;
alter table public.order_notifications enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role::text = 'admin'
  );
$$;

create or replace function public.current_salesman_code()
returns text
language sql
security definer
set search_path = public
as $$
  select salesman_code
  from public.profiles
  where id = auth.uid()
    and role::text = 'salesman'
  limit 1;
$$;

create or replace function public.is_salesman_for_code(target_salesman_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role::text = 'salesman'
      and salesman_code = target_salesman_code
  );
$$;

create or replace function public.protect_profile_privilege_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.id and not public.is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only admins can change profile roles';
    end if;

    if new.salesman_code is distinct from old.salesman_code then
      raise exception 'Only admins can assign salesman codes';
    end if;

    if old.assigned_salesman_code is not null
      and new.assigned_salesman_code is distinct from old.assigned_salesman_code then
      raise exception 'The assigned salesman code cannot be changed';
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists protect_profile_privilege_fields on public.profiles;
create trigger protect_profile_privilege_fields
before update on public.profiles
for each row execute function public.protect_profile_privilege_fields();

drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
on public.profiles for insert
to authenticated
with check (
  public.is_admin()
  or (
    id = auth.uid()
    and role::text = 'customer'
    and salesman_code is null
  )
);

drop policy if exists "profiles update own or admin" on public.profiles;
create policy "profiles update own or admin"
on public.profiles for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

drop policy if exists "salesmen select authenticated" on public.salesmen;
create policy "salesmen select authenticated"
on public.salesmen for select
to authenticated
using (true);

drop policy if exists "salesmen admin insert" on public.salesmen;
create policy "salesmen admin insert"
on public.salesmen for insert
to authenticated
with check (public.is_admin());

drop policy if exists "salesmen admin update" on public.salesmen;
create policy "salesmen admin update"
on public.salesmen for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "salesmen admin delete" on public.salesmen;
create policy "salesmen admin delete"
on public.salesmen for delete
to authenticated
using (public.is_admin());

drop policy if exists "sales clients select admin or assigned salesman" on public.sales_clients;
create policy "sales clients select admin or assigned salesman"
on public.sales_clients for select
to authenticated
using (
  public.is_admin()
  or public.is_salesman_for_code(salesman_code)
);

drop policy if exists "sales clients admin insert" on public.sales_clients;
create policy "sales clients admin insert"
on public.sales_clients for insert
to authenticated
with check (public.is_admin());

drop policy if exists "sales clients salesman insert own" on public.sales_clients;
create policy "sales clients salesman insert own"
on public.sales_clients for insert
to authenticated
with check (
  salesman_code = public.current_salesman_code()
);

drop policy if exists "sales clients admin update" on public.sales_clients;
create policy "sales clients admin update"
on public.sales_clients for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "sales clients admin delete" on public.sales_clients;
create policy "sales clients admin delete"
on public.sales_clients for delete
to authenticated
using (public.is_admin());

drop policy if exists "orders select own or admin" on public.orders;
create policy "orders select own or admin"
on public.orders for select
using (customer_id = auth.uid() or public.is_admin());

drop policy if exists "orders insert own" on public.orders;
create policy "orders insert own"
on public.orders for insert
to authenticated
with check (customer_id = auth.uid());

drop policy if exists "orders admin update" on public.orders;
create policy "orders admin update"
on public.orders for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "orders admin delete" on public.orders;
create policy "orders admin delete"
on public.orders for delete
using (public.is_admin());

drop policy if exists "order items select own or admin" on public.order_items;
create policy "order items select own or admin"
on public.order_items for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.customer_id = auth.uid()
  )
);

drop policy if exists "order items insert own" on public.order_items;
create policy "order items insert own"
on public.order_items for insert
with check (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.customer_id = auth.uid()
  )
);

drop policy if exists "order items admin delete" on public.order_items;
create policy "order items admin delete"
on public.order_items for delete
using (public.is_admin());

drop policy if exists "product overrides public select" on public.product_overrides;
create policy "product overrides public select"
on public.product_overrides for select
using (true);

drop policy if exists "product overrides admin insert" on public.product_overrides;
create policy "product overrides admin insert"
on public.product_overrides for insert
to authenticated
with check (public.is_admin());

drop policy if exists "product overrides admin update" on public.product_overrides;
create policy "product overrides admin update"
on public.product_overrides for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "product overrides admin delete" on public.product_overrides;
create policy "product overrides admin delete"
on public.product_overrides for delete
to authenticated
using (public.is_admin());

drop policy if exists "order notifications admin select" on public.order_notifications;
create policy "order notifications admin select"
on public.order_notifications for select
to authenticated
using (public.is_admin());

drop policy if exists "order notifications insert own" on public.order_notifications;
create policy "order notifications insert own"
on public.order_notifications for insert
to authenticated
with check (
  exists (
    select 1
    from public.orders
    where orders.id = order_notifications.order_id
      and orders.customer_id = auth.uid()
  )
);

drop policy if exists "order notifications admin update" on public.order_notifications;
create policy "order notifications admin update"
on public.order_notifications for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "order notifications admin delete" on public.order_notifications;
create policy "order notifications admin delete"
on public.order_notifications for delete
to authenticated
using (public.is_admin());

-- After you create your own user account from the catalog, make yourself admin:
-- update public.profiles set role = 'admin' where email = 'your-email@example.com';
