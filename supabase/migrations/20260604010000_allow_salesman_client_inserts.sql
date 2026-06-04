drop policy if exists "sales clients salesman insert own" on public.sales_clients;
create policy "sales clients salesman insert own"
on public.sales_clients for insert
to authenticated
with check (
  salesman_code = public.current_salesman_code()
);
