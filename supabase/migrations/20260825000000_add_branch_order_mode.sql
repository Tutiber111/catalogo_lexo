create table if not exists public.client_branches (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete cascade,
  sales_client_id uuid references public.sales_clients(id) on delete cascade,
  name text not null,
  address text not null default '',
  locality text not null default '',
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_branches_owner_check check (
    (owner_profile_id is not null and sales_client_id is null)
    or (owner_profile_id is null and sales_client_id is not null)
  ),
  constraint client_branches_name_check check (length(btrim(name)) > 0)
);

create index if not exists client_branches_owner_profile_idx
on public.client_branches (owner_profile_id, sort_order, name);

create index if not exists client_branches_sales_client_idx
on public.client_branches (sales_client_id, sort_order, name);

create unique index if not exists client_branches_owner_name_unique
on public.client_branches (owner_profile_id, lower(btrim(name)))
where owner_profile_id is not null;

create unique index if not exists client_branches_sales_client_name_unique
on public.client_branches (sales_client_id, lower(btrim(name)))
where sales_client_id is not null;

alter table public.client_branches enable row level security;

grant select, insert, update, delete on public.client_branches to authenticated;

drop policy if exists "client branches select own" on public.client_branches;
create policy "client branches select own"
on public.client_branches for select
to authenticated
using (
  public.is_admin()
  or owner_profile_id = auth.uid()
  or exists (
    select 1
    from public.sales_clients
    where sales_clients.id = client_branches.sales_client_id
      and public.is_salesman_for_code(sales_clients.salesman_code)
  )
);

drop policy if exists "client branches insert own" on public.client_branches;
create policy "client branches insert own"
on public.client_branches for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    public.is_admin()
    or owner_profile_id = auth.uid()
    or exists (
      select 1
      from public.sales_clients
      where sales_clients.id = client_branches.sales_client_id
        and public.is_salesman_for_code(sales_clients.salesman_code)
    )
  )
);

drop policy if exists "client branches update own" on public.client_branches;
create policy "client branches update own"
on public.client_branches for update
to authenticated
using (
  public.is_admin()
  or owner_profile_id = auth.uid()
  or exists (
    select 1
    from public.sales_clients
    where sales_clients.id = client_branches.sales_client_id
      and public.is_salesman_for_code(sales_clients.salesman_code)
  )
)
with check (
  public.is_admin()
  or owner_profile_id = auth.uid()
  or exists (
    select 1
    from public.sales_clients
    where sales_clients.id = client_branches.sales_client_id
      and public.is_salesman_for_code(sales_clients.salesman_code)
  )
);

drop policy if exists "client branches delete own" on public.client_branches;
create policy "client branches delete own"
on public.client_branches for delete
to authenticated
using (
  public.is_admin()
  or owner_profile_id = auth.uid()
  or exists (
    select 1
    from public.sales_clients
    where sales_clients.id = client_branches.sales_client_id
      and public.is_salesman_for_code(sales_clients.salesman_code)
  )
);

alter table public.orders add column if not exists branch_order_group_id uuid;
alter table public.orders add column if not exists client_branch_id uuid;
alter table public.orders add column if not exists branch_name text not null default '';
alter table public.orders add column if not exists branch_address text not null default '';
alter table public.orders add column if not exists branch_locality text not null default '';

do $$
begin
  alter table public.orders
    add constraint orders_client_branch_id_fkey
    foreign key (client_branch_id) references public.client_branches(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists orders_branch_order_group_idx
on public.orders (branch_order_group_id);

create index if not exists orders_client_branch_idx
on public.orders (client_branch_id);

notify pgrst, 'reload schema';
