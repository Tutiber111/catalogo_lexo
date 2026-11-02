-- Read-only verification under real application roles, with no business changes.
begin;
do $$
declare admin_ uuid;seller_ uuid;customer_ uuid;expected_ text;actual_ text;denied_ boolean;
begin
 select id into strict admin_ from public.profiles where role::text='admin' order by id limit 1;
 select id into strict seller_ from public.profiles where role::text='salesman' order by id limit 1;
 select id into strict customer_ from public.profiles where role::text='customer' order by id limit 1;
 perform set_config('request.jwt.claim.sub',admin_::text,true);
 set local role authenticated;
 select md5(json_build_object('available',true,
   'batches',coalesce((select json_agg(row_to_json(b)) from (
     select id,source_name,from_date,to_date,warehouse_from_date from public.sales_history_batches order by id
   ) b),'[]'::json),
   'lines',coalesce((select json_agg(row_to_json(h)) from (
     select line_key,order_key,order_date,client_code,client_name,sku,product_name,locality,province,
       ordered_qty,invoiced_qty,returned_qty,ordered_net,invoiced_net,batch_id,source_row
     from public.sales_history_lines order by line_key
   ) h),'[]'::json)
 )::text) into expected_;
 select md5(public.sales_dashboard_history_json()::text) into actual_;
 assert expected_=actual_,'Cached history differs from current source data';
 assert (select count(*) from public.sales_dashboard_history_cache)=1,'Cache must contain one snapshot';
 perform set_config('request.jwt.claim.sub',seller_::text,true);
 denied_=false;begin perform public.sales_dashboard_history_json();exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Salesperson received company history';
 assert (select count(*) from public.sales_dashboard_history_cache)=0,'Cache RLS widened salesperson access';
 perform set_config('request.jwt.claim.sub',customer_::text,true);
 denied_=false;begin perform public.sales_dashboard_history_json();exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Customer received company history';
 assert (select count(*) from public.sales_dashboard_history_cache)=0,'Cache RLS widened customer access';
 assert not has_table_privilege('anon','public.sales_dashboard_history_cache','select'),'Anonymous cache read';
 assert not has_table_privilege('authenticated','public.sales_dashboard_history_cache','update'),'Browser cache write';
 assert not has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='refresh_dashboard_history_cache'),'execute'),'Browser rebuild access';
 assert not has_function_privilege('service_role',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='refresh_dashboard_history_cache'),'execute'),'Rebuild must be trigger/internal only';
 assert not (select prosecdef from pg_proc where oid='public.sales_dashboard_history_json()'::regprocedure),'History reader bypasses RLS';
end $$;
rollback;
