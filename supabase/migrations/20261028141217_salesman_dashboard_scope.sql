-- Read-only dashboard scope; existing catalog/customer/order RLS stays unchanged.
create function public.sales_dashboard_assignment(client_code text, salesman_code text)
returns text language sql immutable set search_path = '' as $$
 select case when trim(client_code)='81032' then 'unassigned'
 when coalesce(trim(salesman_code),'') in ('','90','900') then '900' else trim(salesman_code) end;
$$;
revoke all on function public.sales_dashboard_assignment(text,text) from public, anon;
grant execute on function public.sales_dashboard_assignment(text,text) to authenticated;

create function public.sales_dashboard_scope(p_salesman_code text default null, p_include_history boolean default true)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller public.profiles%rowtype; target text; payload jsonb;
begin
 select * into caller from public.profiles where id=auth.uid();
 if not found or coalesce(caller.role::text,'') not in ('admin','salesman') then
   raise exception 'Dashboard access denied' using errcode='42501';
 end if;
 if caller.role::text='salesman' then
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
