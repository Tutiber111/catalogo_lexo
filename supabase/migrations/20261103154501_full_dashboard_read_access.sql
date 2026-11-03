-- A dashboard-only capability. Never change is_admin(), operational RLS or roles.
alter table public.profiles add column dashboard_full_access boolean not null default false;

create function public.can_read_full_sales_dashboard() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid())
   and (role::text='admin' or (role::text='salesman' and dashboard_full_access)));
$$;
revoke all on function public.can_read_full_sales_dashboard() from public,anon;
grant execute on function public.can_read_full_sales_dashboard() to authenticated;

-- Protect INSERT as well as UPDATE: a signup/upsert cannot self-grant access.
create function private.protect_dashboard_access() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op='INSERT' and new.dashboard_full_access)
 or (tg_op='UPDATE' and new.dashboard_full_access is distinct from old.dashboard_full_access) then
   if auth.uid() is not null and not public.is_admin() then
     raise exception 'Only admins can change dashboard access' using errcode='42501';
   end if;
 end if;
 return new;
end;$$;
revoke all on function private.protect_dashboard_access() from public,anon,authenticated,service_role;
create trigger protect_dashboard_access before insert or update of dashboard_full_access
 on public.profiles for each row execute function private.protect_dashboard_access();

create function public.dashboard_access_accounts() returns json
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 return (select coalesce(json_agg(row_to_json(p) order by p.name,p.email),'[]'::json) from (
   select p.id,p.name,u.email,p.salesman_code,p.dashboard_full_access
   from public.profiles p join auth.users u on u.id=p.id where p.role::text='salesman'
 ) p);
end;$$;
create function public.set_dashboard_full_access(p_profile_id uuid,p_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Admin required' using errcode='42501';end if;
 if p_enabled is null then raise exception 'Access value required' using errcode='22023';end if;
 update public.profiles set dashboard_full_access=p_enabled where id=p_profile_id and role::text='salesman';
 if not found then raise exception 'Salesperson account not found' using errcode='22023';end if;
end;$$;
revoke all on function public.dashboard_access_accounts(),public.set_dashboard_full_access(uuid,boolean) from public,anon;
grant execute on function public.dashboard_access_accounts(),public.set_dashboard_full_access(uuid,boolean) to authenticated;

-- Narrow read-only API: exposing reporting data does not widen catalog order,
-- client selection, profile, stock or product-override permissions.
create function public.sales_dashboard_full_context() returns json
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_read_full_sales_dashboard() then raise exception 'Full dashboard access required' using errcode='42501';end if;
 return (select json_build_object('available',true,
 'clients',coalesce((select json_agg(row_to_json(c) order by c.client_code) from (
   select id,client_code,name,legal_name,address,locality,salesman_code,source_salesman_label from public.sales_clients
 ) c),'[]'::json),
 'orders',coalesce((select json_agg(row_to_json(o) order by o.created_at,o.id) from (
   select o.id,o.customer_id,o.order_number,o.created_at,o.status,o.customer_name,o.sales_client_id,o.sales_client_code,
     o.customer_client_code,o.sales_client_name,o.sales_client_locality,o.salesman_code,o.total_items,o.total_value,
     coalesce((select json_agg(row_to_json(i) order by i.id) from (
       select id,sku,name,quantity,unit_price,line_total from public.order_items where order_id=o.id
     ) i),'[]'::json) as order_items
   from public.orders o where o.status::text not in ('draft','cancelled')
 ) o),'[]'::json)));
end;$$;
revoke all on function public.sales_dashboard_full_context() from public,anon;
grant execute on function public.sales_dashboard_full_context() to authenticated;

alter policy "dashboard history cache admin reader" on public.sales_dashboard_history_cache
 using ((select public.can_read_full_sales_dashboard()));
create or replace function public.sales_dashboard_history_json() returns json
language plpgsql stable security invoker set search_path='' as $$
declare result_ json;
begin
 if not public.can_read_full_sales_dashboard() then raise exception 'Full dashboard history access required' using errcode='42501';end if;
 select payload into strict result_ from public.sales_dashboard_history_cache where singleton;
 return result_;
end;$$;
revoke all on function public.sales_dashboard_history_json() from public,anon;
grant execute on function public.sales_dashboard_history_json() to authenticated;

-- Scope and grouping reads accept full dashboard viewers; write RPCs remain admin-only.
create or replace function public.sales_dashboard_scope(p_salesman_code text default null, p_include_history boolean default true)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles%rowtype; target text; payload jsonb;
begin
 select * into caller from public.profiles where id=auth.uid();
 if not found or coalesce(caller.role::text,'') not in ('admin','salesman') then
   raise exception 'Dashboard access denied' using errcode='42501';
 end if;
 if caller.role::text='salesman' and not caller.dashboard_full_access then
   if coalesce(trim(caller.salesman_code),'')='' then raise exception 'Salesperson code required' using errcode='42501'; end if;
   target=case when trim(caller.salesman_code) in ('90','900') then '900' else trim(caller.salesman_code) end;
   if p_salesman_code is not null and p_salesman_code<>target then raise exception 'Portfolio access denied' using errcode='42501'; end if;
 else
   target=case when p_salesman_code='90' then '900' else trim(p_salesman_code) end;
   if target is null or target='' or target='*' then raise exception 'Choose one salesperson' using errcode='22023'; end if;
 end if;
 with scoped_clients as materialized (
   select c.* from public.sales_clients c
   where public.sales_dashboard_assignment(c.client_code,c.salesman_code)=target
 ), scoped_orders as materialized (
   select o.* from public.orders o left join public.sales_clients c
   on case when o.sales_client_id is not null then c.id=o.sales_client_id
      else c.client_code=coalesce(nullif(trim(o.sales_client_code),''),nullif(trim(o.customer_client_code),'')) end
   where o.status::text not in ('draft','cancelled')
     and public.sales_dashboard_assignment(c.client_code,c.salesman_code)=target
 ), scoped_history as materialized (
   select h.* from public.sales_history_lines h left join public.sales_clients c on c.client_code=h.client_code
   where p_include_history and public.sales_dashboard_assignment(h.client_code,c.salesman_code)=target
 )
 select jsonb_build_object('salesmanCode',target,'available',true,
   'clients',coalesce((select jsonb_agg(to_jsonb(c) order by c.client_code) from scoped_clients c),'[]'::jsonb),
   'orders',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('order_items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb)) order by o.created_at,o.id) from scoped_orders o),'[]'::jsonb),
   'batches',case when p_include_history then coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from public.sales_history_batches b),'[]'::jsonb) else '[]'::jsonb end,
   'lines',coalesce((select jsonb_agg(to_jsonb(h) order by h.line_key) from scoped_history h),'[]'::jsonb)
 ) into payload;
 return payload;
end;
$$;
revoke all on function public.sales_dashboard_scope(text,boolean) from public,anon;
grant execute on function public.sales_dashboard_scope(text,boolean) to authenticated;

create or replace function public.get_dashboard_client_groups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller public.profiles%rowtype;result_ jsonb;
begin
 select * into caller from public.profiles where id=auth.uid();
 if not found or coalesce(caller.role::text,'') not in ('admin','salesman') then raise exception 'Dashboard access denied' using errcode='42501';end if;
 if caller.role::text='salesman' and not caller.dashboard_full_access and coalesce(trim(caller.salesman_code),'')='' then raise exception 'Salesperson code required' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(g) order by g.name,g.id),'[]'::jsonb) into result_ from (
 select g.id,g.name,jsonb_agg(m.client_code order by m.client_code) as "clientCodes"
 from public.dashboard_client_groups g join public.dashboard_client_group_members m on m.group_id=g.id
 left join public.sales_clients c on c.client_code=m.client_code
 where public.can_read_full_sales_dashboard() or public.sales_dashboard_assignment(m.client_code,c.salesman_code)=case when trim(caller.salesman_code)='90' then '900' else trim(caller.salesman_code) end
 group by g.id,g.name) g;
 return result_;
end;$$;


create or replace function public.sales_restock_inbox(p_salesman_code text default null,p_include_done boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare caller public.profiles%rowtype;target_ text;result_ jsonb;
begin
 select * into caller from public.profiles where id=auth.uid();
 if not found or coalesce(caller.role::text,'') not in ('admin','salesman','customer') then raise exception 'Access denied' using errcode='42501'; end if;
 if public.can_read_full_sales_dashboard() then target_=nullif(trim(p_salesman_code),'');
 elsif caller.role::text='salesman' then
   if coalesce(trim(caller.salesman_code),'')='' then raise exception 'Salesperson code required' using errcode='42501'; end if;
   target_=case when caller.salesman_code='90' then '900' else caller.salesman_code end;
   if p_salesman_code is not null and p_salesman_code<>target_ then raise exception 'Portfolio denied' using errcode='42501'; end if;
 elsif p_salesman_code is not null then raise exception 'Portfolio denied' using errcode='42501'; end if;
 with recursive scoped_clients as materialized (
   select c.* from public.sales_clients c where
   case when caller.role::text='customer' then c.client_code=nullif(caller.client_code,'')
   else target_ is null or public.sales_dashboard_assignment(c.client_code,c.salesman_code)=target_ end
 ), facts as materialized (select f.* from private.sales_product_facts f join scoped_clients c on c.client_code=f.client_code), eligible as materialized (
   select distinct on (b.id,c.client_code,p.brand,upper(trim(p.sku))) b.*,r.seen_at,r.done_at,rp.product_id,rp.received_qty,rp.available_qty,p.sku,p.brand,p.name,c.client_code,c.name as client_name
   from public.sales_restock_batches b join public.sales_restock_products rp on rp.batch_id=b.id
   join public.sales_catalog_products p on p.product_id=rp.product_id
   cross join scoped_clients c left join public.sales_restock_receipts r on r.batch_id=b.id and r.user_id=caller.id
   left join public.product_overrides po on po.product_id=p.product_id
   where b.active and rp.was_out and not rp.is_new and p.active and not coalesce(po.hidden,false) and not coalesce(po.out_of_stock,p.base_out_of_stock)
   and (select count(distinct cp.brand) from public.sales_catalog_products cp where upper(trim(cp.sku))=upper(trim(p.sku)) and cp.active)=1
   and (p_include_done or r.done_at is null)
   order by b.id,c.client_code,p.brand,upper(trim(p.sku)),p.product_id
 ), days as (
   select distinct e.id,e.client_code,f.day from eligible e join facts f on f.client_code=e.client_code
   where f.day>=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date-interval '12 months' and f.day<=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date and f.delivered_qty>0
 ), numbered as(select *,row_number() over(partition by id,client_code order by day) as n from days),
 occasions as(
   select id,client_code,n,day,day as anchor from numbered where n=1
   union all
   select d.id,d.client_code,d.n,d.day,case when d.day-o.anchor<=2 then o.anchor else d.day end from occasions o join numbered d on d.id=o.id and d.client_code=o.client_code and d.n=o.n+1
 ), stats as(
   select e.id,e.client_code,e.product_id,count(distinct o.anchor) as purchases,min(o.anchor) as first_day,max(o.anchor) as last_day
   from eligible e join facts f on f.client_code=e.client_code and f.sku=upper(trim(e.sku)) and f.delivered_qty>0
   join occasions o on o.id=e.id and o.client_code=e.client_code and o.day=f.day group by e.id,e.client_code,e.product_id
 ), relevant as(
   select e.*,coalesce(s.purchases,0) as purchases,s.last_day,
   case when s.purchases>=2 then (s.last_day-s.first_day)::numeric/(s.purchases-1) end as frequency,
   (select sum(f.delivered_qty)/nullif(s.purchases,0) from facts f where f.client_code=e.client_code and f.sku=upper(trim(e.sku)) and f.day>=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date-interval '12 months' and f.day<=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date) as usual_qty,
   coalesce((select sum(f.nostock_qty) from facts f where f.client_code=e.client_code and f.sku=upper(trim(e.sku)) and f.day>=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date-interval '12 months' and f.day<=(e.received_at at time zone 'America/Argentina/Buenos_Aires')::date),0) as missed_qty
   from eligible e left join stats s on s.id=e.id and s.client_code=e.client_code and s.product_id=e.product_id
 ), groups as(
   select id,title,received_at,seen_at,done_at,jsonb_agg(jsonb_build_object('productId',product_id,'sku',sku,'name',name,'brand',brand,'clientCode',client_code,'clientName',client_name,'purchases',purchases,'frequency',frequency,'usualQty',usual_qty,'lastPurchase',last_day,'missedQty',missed_qty) order by client_name,sku) as products
   from relevant where purchases>=2 or missed_qty>0 group by id,title,received_at,seen_at,done_at
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'receivedAt',received_at,'seenAt',seen_at,'doneAt',done_at,'products',products) order by received_at desc,id),'[]'::jsonb) into result_ from groups;
 return result_;
end;$$;

revoke all on function public.get_dashboard_client_groups(),public.sales_restock_inbox(text,boolean) from public,anon;
grant execute on function public.get_dashboard_client_groups(),public.sales_restock_inbox(text,boolean) to authenticated;
