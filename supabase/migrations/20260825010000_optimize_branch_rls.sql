drop policy if exists "client branches select own" on public.client_branches;
create policy "client branches select own"
on public.client_branches for select
to authenticated
using (
  public.is_admin()
  or owner_profile_id = (select auth.uid())
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
  created_by = (select auth.uid())
  and (
    public.is_admin()
    or owner_profile_id = (select auth.uid())
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
  or owner_profile_id = (select auth.uid())
  or exists (
    select 1
    from public.sales_clients
    where sales_clients.id = client_branches.sales_client_id
      and public.is_salesman_for_code(sales_clients.salesman_code)
  )
)
with check (
  public.is_admin()
  or owner_profile_id = (select auth.uid())
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
  or owner_profile_id = (select auth.uid())
  or exists (
    select 1
    from public.sales_clients
    where sales_clients.id = client_branches.sales_client_id
      and public.is_salesman_for_code(sales_clients.salesman_code)
  )
);

notify pgrst, 'reload schema';
