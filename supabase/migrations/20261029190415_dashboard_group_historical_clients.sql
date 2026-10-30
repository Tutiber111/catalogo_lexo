-- Historical client codes are valid reporting identities, without creating catalog clients.
alter table public.dashboard_client_group_members
 drop constraint dashboard_client_group_members_client_code_fkey;

create function public.get_dashboard_group_candidates() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result_ jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='admin') then raise exception 'Admin required' using errcode='42501';end if;
 with history as (
   select client_code,
    (array_agg(client_name order by order_date desc,line_key desc) filter(where coalesce(trim(client_name),'')<>''))[1] as name,
    string_agg(distinct client_name,' ') as aliases
   from public.sales_history_lines where coalesce(trim(client_code),'')<>'' group by client_code
 ), candidates as (
   select c.id::text,c.client_code,c.name,c.legal_name,c.address,c.locality,c.salesman_code,
    coalesce(h.aliases,'') as search_aliases,false as historical_only
   from public.sales_clients c left join history h on h.client_code=c.client_code
   union all
   select ''::text,h.client_code,coalesce(h.name,h.client_code),''::text,''::text,''::text,
    public.sales_dashboard_assignment(h.client_code,null),coalesce(h.aliases,''),true
   from history h where not exists(select 1 from public.sales_clients c where c.client_code=h.client_code)
 ) select coalesce(jsonb_agg(to_jsonb(c) order by c.client_code),'[]'::jsonb) into result_ from candidates c;
 return result_;
end;$$;
revoke all on function public.get_dashboard_group_candidates() from public,anon;
grant execute on function public.get_dashboard_group_candidates() to authenticated;

create or replace function public.get_dashboard_client_groups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller public.profiles%rowtype;result_ jsonb;
begin
 select * into caller from public.profiles where id=auth.uid();
 if not found or coalesce(caller.role::text,'') not in ('admin','salesman') then raise exception 'Dashboard access denied' using errcode='42501';end if;
 if caller.role::text='salesman' and coalesce(trim(caller.salesman_code),'')='' then raise exception 'Salesperson code required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(g) order by g.name,g.id),'[]'::jsonb) into result_ from (
 select g.id,g.name,jsonb_agg(m.client_code order by m.client_code) as "clientCodes"
 from public.dashboard_client_groups g join public.dashboard_client_group_members m on m.group_id=g.id
 left join public.sales_clients c on c.client_code=m.client_code
 where caller.role::text='admin' or public.sales_dashboard_assignment(m.client_code,c.salesman_code)=case when trim(caller.salesman_code)='90' then '900' else trim(caller.salesman_code) end
 group by g.id,g.name) g;
 return result_;
end;$$;

create or replace function public.save_dashboard_client_group(p_id uuid,p_name text,p_client_codes text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare id_ uuid;codes_ text[];
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='admin') then raise exception 'Admin required' using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('dashboard-client-groups'));
 select array_agg(distinct trim(code) order by trim(code)) into codes_ from unnest(p_client_codes) code where trim(code)<>'';
 if coalesce(cardinality(codes_),0)<2 or coalesce(length(trim(p_name)),0) not between 1 and 120 then raise exception 'Choose a name and at least two client codes' using errcode='22023';end if;
 if exists(select 1 from unnest(codes_) code
   where not exists(select 1 from public.sales_clients c where c.client_code=code)
   and not exists(select 1 from public.sales_history_lines h where h.client_code=code)) then raise exception 'Unknown client code' using errcode='22023';end if;
 if exists(select 1 from public.dashboard_client_group_members where client_code=any(codes_) and (p_id is null or group_id<>p_id)) then raise exception 'A client already belongs to another group' using errcode='23505';end if;
 if p_id is null then insert into public.dashboard_client_groups(name) values(trim(p_name)) returning id into id_;
 else update public.dashboard_client_groups set name=trim(p_name),updated_at=now() where id=p_id returning id into id_;
 if not found then raise exception 'Group not found' using errcode='22023';end if;end if;
 delete from public.dashboard_client_group_members where group_id=id_;
 insert into public.dashboard_client_group_members(client_code,group_id) select code,id_ from unnest(codes_) code;
 return id_;
end;$$;
revoke all on function public.get_dashboard_client_groups(),public.save_dashboard_client_group(uuid,text,text[]) from public,anon;
grant execute on function public.get_dashboard_client_groups(),public.save_dashboard_client_group(uuid,text,text[]) to authenticated;
