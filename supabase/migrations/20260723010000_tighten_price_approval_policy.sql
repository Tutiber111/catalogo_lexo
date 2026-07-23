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
    and price_access_approved = false
    and price_access_approved_at is null
    and price_access_approved_by is null
  )
);
