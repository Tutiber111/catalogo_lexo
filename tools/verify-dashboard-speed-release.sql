-- Production checks with actual profiles. Temporary groups and session claims are rolled back.
begin;
do $$
declare admin_ uuid;seller_ uuid;customer_ uuid;code_ text;own_ text;payload_ jsonb;candidates_ jsonb;group_ uuid;denied_ bool;count_ bigint;net_ numeric;invoice_ numeric;
begin
 select id into strict admin_ from public.profiles where role::text='admin' order by id limit 1;
 select p.id,case when trim(p.salesman_code)='90' then '900' else trim(p.salesman_code) end into strict seller_,code_
 from public.profiles p where p.role::text='salesman' and coalesce(trim(p.salesman_code),'')<>'' and trim(p.salesman_code) not in ('90','900')
 and exists(select 1 from public.sales_clients c where public.sales_dashboard_assignment(c.client_code,c.salesman_code)=trim(p.salesman_code)) order by p.id limit 1;
 select c.client_code into strict own_ from public.sales_clients c where public.sales_dashboard_assignment(c.client_code,c.salesman_code)=code_ and c.client_code<>'80605' and not exists(select 1 from public.dashboard_client_group_members m where m.client_code=c.client_code) order by c.client_code limit 1;
 select id into strict customer_ from public.profiles where role::text='customer' order by id limit 1;
 perform set_config('request.jwt.claim.sub',admin_::text,true);
 set local role authenticated;
 select count(*),sum(ordered_net),sum(invoiced_net) into count_,net_,invoice_ from public.sales_history_lines;
 payload_=public.sales_dashboard_history_json();
 assert jsonb_array_length(payload_->'lines')=count_,'Snapshot history count differs';
 assert (select sum((h->>'ordered_net')::numeric) from jsonb_array_elements(payload_->'lines') h)=net_,'Snapshot ordered amount differs';
 assert (select sum((h->>'invoiced_net')::numeric) from jsonb_array_elements(payload_->'lines') h)=invoice_,'Snapshot invoiced amount differs';
 candidates_=public.get_dashboard_group_candidates();
 assert (select count(*) from jsonb_array_elements(candidates_) c where c->>'client_code'='80605')=1,'Tina candidate missing or duplicated';
 assert exists(select 1 from jsonb_array_elements(candidates_) c where c->>'client_code'='80605' and (coalesce(c->>'name','')||' '||coalesce(c->>'search_aliases','')) ilike '%tina%'),'Tina name search missing';
 if not exists(select 1 from jsonb_array_elements(public.get_dashboard_client_groups()) b where b->'clientCodes' ? '80605') then
   group_=public.save_dashboard_client_group(null,'__release_validation_history__',array[own_,'80605']);
   assert exists(select 1 from jsonb_array_elements(public.get_dashboard_client_groups()) g where g->>'id'=group_::text and g->'clientCodes' ? '80605'),'Historical grouping failed';
 end if;
 perform set_config('request.jwt.claim.sub',seller_::text,true);
 denied_=false;begin perform public.sales_dashboard_history_json();exception when insufficient_privilege then denied_=true;end;assert denied_,'Salesperson received company history';
 denied_=false;begin perform public.get_dashboard_group_candidates();exception when insufficient_privilege then denied_=true;end;assert denied_,'Salesperson received admin candidate list';
 if group_ is not null then
   assert exists(select 1 from jsonb_array_elements(public.get_dashboard_client_groups()) g where g->>'id'=group_::text and g->'clientCodes'=jsonb_build_array(own_)),'Historical grouping widens portfolio access';
 end if;
 perform set_config('request.jwt.claim.sub',customer_::text,true);
 denied_=false;begin perform public.sales_dashboard_history_json();exception when insufficient_privilege then denied_=true;end;assert denied_,'Customer received company history';
 denied_=false;begin perform public.get_dashboard_group_candidates();exception when insufficient_privilege then denied_=true;end;assert denied_,'Customer received admin candidate list';
 perform set_config('request.jwt.claim.sub',admin_::text,true);
 if group_ is not null then perform public.delete_dashboard_client_group(group_);end if;
 assert not has_function_privilege('anon','public.sales_dashboard_history_json()','execute'),'Anonymous history grant';
 assert not has_function_privilege('anon','public.get_dashboard_group_candidates()','execute'),'Anonymous candidates grant';
end $$;
rollback;
