-- Production read-only role checks. All session settings are rolled back.
begin;
do $$
declare admin_ uuid;seller_ uuid;customer_ uuid;code_ text;other_ text;seller_data jsonb;preview_data jsonb;denied_ boolean;inbox_ jsonb;
begin
 select id into strict admin_ from public.profiles where role::text='admin' order by id limit 1;
 select p.id,case when trim(p.salesman_code)='90' then '900' else trim(p.salesman_code) end into strict seller_,code_
 from public.profiles p where p.role::text='salesman' and coalesce(trim(p.salesman_code),'')<>''
 and exists(select 1 from public.sales_clients c where public.sales_dashboard_assignment(c.client_code,c.salesman_code)=case when trim(p.salesman_code)='90' then '900' else trim(p.salesman_code) end) order by p.id limit 1;
 select public.sales_dashboard_assignment(client_code,salesman_code) into strict other_ from public.sales_clients
 where public.sales_dashboard_assignment(client_code,salesman_code)<>code_ limit 1;
 perform set_config('request.jwt.claim.sub',seller_::text,true);
 seller_data=public.sales_dashboard_scope(null,true);
 assert seller_data->>'salesmanCode'=code_,'Wrong salesperson scope';
 assert jsonb_array_length(seller_data->'clients')>0,'No clients in verification portfolio';
 assert not exists(select 1 from jsonb_array_elements(seller_data->'clients') c where public.sales_dashboard_assignment(c->>'client_code',c->>'salesman_code')<>code_),'Other portfolio client exposed';
 assert not exists(select 1 from jsonb_array_elements(seller_data->'lines') h left join public.sales_clients c on c.client_code=h->>'client_code' where public.sales_dashboard_assignment(h->>'client_code',c.salesman_code)<>code_),'Other portfolio history exposed';
 denied_=false;begin perform public.sales_dashboard_scope(other_,false);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Other portfolio scope accepted';
 denied_=false;begin perform public.sales_restock_inbox(other_,false);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Other portfolio inbox accepted';
 perform public.sales_company_bestsellers();
 perform set_config('request.jwt.claim.sub',admin_::text,true);
 preview_data=public.sales_dashboard_scope(code_,true);
 assert preview_data=seller_data,'Admin preview differs from actual salesperson scope';
 perform public.sales_restock_inbox(code_,false);
 select p.id into strict customer_ from public.profiles p where p.role::text='customer' and exists(select 1 from public.sales_clients c where c.client_code=nullif(p.client_code,'')) order by p.id limit 1;
 perform set_config('request.jwt.claim.sub',customer_::text,true);
 inbox_=public.sales_restock_inbox(null,false);
 assert jsonb_typeof(inbox_)='array','Invalid customer inbox';
 denied_=false;begin perform public.sales_dashboard_scope(code_,false);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Customer accessed dashboard';
 denied_=false;begin perform public.sales_restock_inbox(other_,false);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Customer requested salesperson inbox';
 denied_=false;begin perform public.sales_company_bestsellers();exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Customer accessed company ranking';
 perform set_config('request.jwt.claim.sub','',true);
 denied_=false;begin perform public.sales_restock_inbox(null,false);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Anonymous inbox accepted';
 denied_=false;begin perform public.picking_receive_arrival('{"secret":"release-verification-invalid-secret"}'::jsonb);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Invalid arrival secret accepted';
 assert not has_function_privilege('anon','public.sales_dashboard_scope(text,boolean)','execute'),'Anonymous scope execution granted';
 assert not has_function_privilege('anon','public.sales_restock_inbox(text,boolean)','execute'),'Anonymous inbox execution granted';
 assert not has_table_privilege('authenticated','public.sales_restock_receipts','select'),'Direct receipt reads granted';
 assert not has_table_privilege('authenticated','public.sales_order_fulfillment','select'),'Direct company fulfillment reads granted';
end $$;
rollback;
