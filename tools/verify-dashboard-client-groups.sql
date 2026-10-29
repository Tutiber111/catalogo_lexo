-- Exercises the real RPCs with existing profiles; all group changes are rolled back.
begin;
do $$
declare admin_ uuid;seller_ uuid;customer_ uuid;code_ text;own_ text;other_ text;group_ uuid;rows_ jsonb;denied_ bool;before_ text;after_ text;
begin
 select id into strict admin_ from public.profiles where role::text='admin' order by id limit 1;
 select p.id,case when trim(p.salesman_code)='90' then '900' else trim(p.salesman_code) end into strict seller_,code_
 from public.profiles p where p.role::text='salesman' and coalesce(trim(p.salesman_code),'')<>''
 and exists(select 1 from public.sales_clients c where public.sales_dashboard_assignment(c.client_code,c.salesman_code)=case when trim(p.salesman_code)='90' then '900' else trim(p.salesman_code) end) order by p.id limit 1;
 select c.client_code into strict own_ from public.sales_clients c where public.sales_dashboard_assignment(c.client_code,c.salesman_code)=code_ order by c.client_code limit 1;
 select c.client_code into strict other_ from public.sales_clients c where public.sales_dashboard_assignment(c.client_code,c.salesman_code)<>code_ order by c.client_code limit 1;
 select md5(string_agg(client_code||':'||coalesce(salesman_code,''),',' order by client_code)) into before_ from public.sales_clients;
 perform set_config('request.jwt.claim.sub',admin_::text,true);
 group_=public.save_dashboard_client_group(null,'__release_validation__',array[own_,other_]);
 rows_=public.get_dashboard_client_groups();
 assert exists(select 1 from jsonb_array_elements(rows_) g where g->>'id'=group_::text and jsonb_array_length(g->'clientCodes')=2),'Admin group create/read failed';
 perform set_config('request.jwt.claim.sub',seller_::text,true);
 rows_=public.get_dashboard_client_groups();
 assert exists(select 1 from jsonb_array_elements(rows_) g where g->>'id'=group_::text and g->'clientCodes'=jsonb_build_array(own_)),'Group exposes another portfolio';
 denied_=false;begin perform public.save_dashboard_client_group(group_,'Denied',array[own_,other_]);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Salesperson group edit accepted';
 denied_=false;begin perform public.delete_dashboard_client_group(group_);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Salesperson group deletion accepted';
 select id into strict customer_ from public.profiles where role::text='customer' order by id limit 1;
 perform set_config('request.jwt.claim.sub',customer_::text,true);
 denied_=false;begin perform public.get_dashboard_client_groups();exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Customer group read accepted';
 perform set_config('request.jwt.claim.sub',admin_::text,true);
 perform public.save_dashboard_client_group(group_,'__release_validation_renamed__',array[own_,other_]);
 rows_=public.get_dashboard_client_groups();
 assert exists(select 1 from jsonb_array_elements(rows_) g where g->>'id'=group_::text and g->>'name'='__release_validation_renamed__'),'Group edit failed';
 perform public.delete_dashboard_client_group(group_);
 rows_=public.get_dashboard_client_groups();
 assert not exists(select 1 from jsonb_array_elements(rows_) g where g->>'id'=group_::text),'Ungroup failed';
 select md5(string_agg(client_code||':'||coalesce(salesman_code,''),',' order by client_code)) into after_ from public.sales_clients;
 assert before_=after_,'Source assignments changed';
 assert not has_function_privilege('anon','public.get_dashboard_client_groups()','execute'),'Anonymous group access granted';
 assert not has_table_privilege('authenticated','public.dashboard_client_groups','select'),'Direct group reads granted';
 assert not has_table_privilege('authenticated','public.dashboard_client_group_members','insert'),'Direct membership writes granted';
end $$;
rollback;
