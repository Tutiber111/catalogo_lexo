create or replace function public.list_pending_assigned_price_access_requests()
returns table (
  id uuid,
  email text,
  name text,
  phone text,
  company text,
  assigned_salesman_code text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_salesman_code text;
begin
  select nullif(btrim(profile.salesman_code), '')
  into actor_salesman_code
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.role::text = 'salesman';

  if actor_salesman_code is null then
    raise exception 'Solo los vendedores con un código asignado pueden ver estas solicitudes.'
      using errcode = '42501';
  end if;

  return query
  select
    profile.id,
    profile.email,
    profile.name,
    profile.phone,
    profile.company,
    profile.assigned_salesman_code,
    profile.created_at
  from public.profiles as profile
  where profile.role::text = 'customer'
    and profile.price_access_approved = false
    and profile.assigned_salesman_code = actor_salesman_code
  order by profile.created_at asc;
end;
$$;

create or replace function public.approve_assigned_price_access_request(p_profile_id uuid)
returns table (
  id uuid,
  email text,
  name text,
  company text,
  price_access_approved boolean,
  price_access_approved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_salesman_code text;
begin
  select nullif(btrim(profile.salesman_code), '')
  into actor_salesman_code
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.role::text = 'salesman';

  if actor_salesman_code is null then
    raise exception 'Solo los vendedores con un código asignado pueden aprobar solicitudes.'
      using errcode = '42501';
  end if;

  return query
  update public.profiles as profile
  set price_access_approved = true,
      price_access_approved_at = now(),
      price_access_approved_by = auth.uid(),
      updated_at = now()
  where profile.id = p_profile_id
    and profile.role::text = 'customer'
    and profile.price_access_approved = false
    and profile.assigned_salesman_code = actor_salesman_code
  returning
    profile.id,
    profile.email,
    profile.name,
    profile.company,
    profile.price_access_approved,
    profile.price_access_approved_at;

  if not found then
    raise exception 'Solicitud no encontrada o no asignada a este vendedor.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.list_pending_assigned_price_access_requests() from public, anon;
revoke all on function public.approve_assigned_price_access_request(uuid) from public, anon;
grant execute on function public.list_pending_assigned_price_access_requests() to authenticated;
grant execute on function public.approve_assigned_price_access_request(uuid) to authenticated;
