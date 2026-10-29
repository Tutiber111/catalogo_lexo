-- Dashboard-only identities. Source clients, orders and salesperson assignments are untouched.
create table public.dashboard_client_groups(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 120),
 updated_at timestamptz not null default now()
);
create table public.dashboard_client_group_members(
 client_code text primary key references public.sales_clients(client_code) on delete cascade,
 group_id uuid not null references public.dashboard_client_groups(id) on delete cascade
);
alter table public.dashboard_client_groups enable row level security;
alter table public.dashboard_client_group_members enable row level security;
revoke all on public.dashboard_client_groups,public.dashboard_client_group_members from public,anon,authenticated;

create function public.get_dashboard_client_groups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller public.profiles%rowtype;result_ jsonb;
begin
 select * into caller from public.profiles where id=auth.uid();
 if not found or coalesce(caller.role::text,'') not in ('admin','salesman') then raise exception 'Dashboard access denied' using errcode='42501';end if;
 if caller.role::text='salesman' and coalesce(trim(caller.salesman_code),'')='' then raise exception 'Salesperson code required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(g) order by g.name,g.id),'[]'::jsonb) into result_ from (
 select g.id,g.name,jsonb_agg(m.client_code order by m.client_code) as "clientCodes"
 from public.dashboard_client_groups g join public.dashboard_client_group_members m on m.group_id=g.id
 join public.sales_clients c on c.client_code=m.client_code
 where caller.role::text='admin' or public.sales_dashboard_assignment(c.client_code,c.salesman_code)=case when trim(caller.salesman_code)='90' then '900' else trim(caller.salesman_code) end
 group by g.id,g.name) g;
 return result_;
end;$$;

create function public.save_dashboard_client_group(p_id uuid,p_name text,p_client_codes text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare id_ uuid;codes_ text[];
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='admin') then raise exception 'Admin required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dashboard-client-groups'));
 select array_agg(distinct trim(code) order by trim(code)) into codes_ from unnest(p_client_codes) code where trim(code)<>'';
 if coalesce(cardinality(codes_),0)<2 or coalesce(length(trim(p_name)),0) not between 1 and 120 then raise exception 'Choose a name and at least two client codes' using errcode='22023';end if;
 if (select count(*) from public.sales_clients where client_code=any(codes_))<>cardinality(codes_) then raise exception 'Unknown client code' using errcode='22023';end if;
 if exists(select 1 from public.dashboard_client_group_members where client_code=any(codes_) and (p_id is null or group_id<>p_id)) then raise exception 'A client already belongs to another group' using errcode='23505';end if;
 if p_id is null then insert into public.dashboard_client_groups(name) values(trim(p_name)) returning id into id_;
 else update public.dashboard_client_groups set name=trim(p_name),updated_at=now() where id=p_id returning id into id_;
 if not found then raise exception 'Group not found' using errcode='22023';end if;end if;
 delete from public.dashboard_client_group_members where group_id=id_;
 insert into public.dashboard_client_group_members(client_code,group_id) select code,id_ from unnest(codes_) code;
 return id_;
end;$$;
create function public.delete_dashboard_client_group(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='admin') then raise exception 'Admin required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dashboard-client-groups'));
 delete from public.dashboard_client_groups where id=p_id;
end;$$;
revoke all on function public.get_dashboard_client_groups(),public.save_dashboard_client_group(uuid,text,text[]),public.delete_dashboard_client_group(uuid) from public,anon;
grant execute on function public.get_dashboard_client_groups(),public.save_dashboard_client_group(uuid,text,text[]),public.delete_dashboard_client_group(uuid) to authenticated;
