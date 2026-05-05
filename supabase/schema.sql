create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  name text not null default '',
  phone text not null default '',
  company text not null default '',
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
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders add column if not exists archived_at timestamptz;

update public.orders
set archived_at = coalesce(archived_at, updated_at, now())
where status = 'sent'
  and archived_at is null;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.product_overrides enable row level security;

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
      and role = 'admin'
  );
$$;

drop policy if exists "profiles select own or admin" on public.profiles;
create policy "profiles select own or admin"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "profiles update own or admin" on public.profiles;
create policy "profiles update own or admin"
on public.profiles for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

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

-- After you create your own user account from the catalog, make yourself admin:
-- update public.profiles set role = 'admin' where email = 'your-email@example.com';
