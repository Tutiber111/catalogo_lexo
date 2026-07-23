alter table public.profiles
  add column if not exists price_access_approved boolean;

alter table public.profiles
  add column if not exists price_access_approved_at timestamptz;

alter table public.profiles
  add column if not exists price_access_approved_by uuid references auth.users(id) on delete set null;

-- Accounts that existed before this feature keep their current catalog access.
update public.profiles
set
  price_access_approved = true,
  price_access_approved_at = coalesce(price_access_approved_at, now())
where price_access_approved is null;

alter table public.profiles
  alter column price_access_approved set default false;

alter table public.profiles
  alter column price_access_approved set not null;

create or replace function public.has_price_access()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        role::text in ('admin', 'salesman')
        or price_access_approved = true
      )
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

    if new.price_access_approved is distinct from old.price_access_approved
      or new.price_access_approved_at is distinct from old.price_access_approved_at
      or new.price_access_approved_by is distinct from old.price_access_approved_by then
      raise exception 'Only admins can approve price access';
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

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

drop policy if exists "orders insert own" on public.orders;
create policy "orders insert own"
on public.orders for insert
to authenticated
with check (
  customer_id = auth.uid()
  and public.has_price_access()
);
