-- Read-only post-release verification. The confirmed grant must already exist.
-- The release runner must set app.verify_dashboard_user to the confirmed profile UUID.
begin;
do $$
declare viewer_ uuid;client_count_ bigint;order_count_ bigint;history_count_ bigint;context_ jsonb;denied_ boolean;
begin
 select p.id into strict viewer_ from public.profiles p
 where p.id=nullif(current_setting('app.verify_dashboard_user',true),'')::uuid and p.role::text='salesman'
 and trim(p.salesman_code)='805' and p.dashboard_full_access;
 select count(*) into client_count_ from public.sales_clients;
 select count(*) into order_count_ from public.orders where status::text not in ('draft','cancelled');
 select count(*) into history_count_ from public.sales_history_lines;
 perform set_config('request.jwt.claim.sub',viewer_::text,true);
 set local role authenticated;
 assert not public.is_admin(),'Viewer became an admin';
 assert public.can_read_full_sales_dashboard(),'Full dashboard read missing';
 context_=public.sales_dashboard_full_context()::jsonb;
 assert jsonb_array_length(context_->'clients')=client_count_,'Company clients missing';
 assert jsonb_array_length(context_->'orders')=order_count_,'Company orders missing';
 assert json_array_length(public.sales_dashboard_history_json()->'lines')=history_count_,'Company history missing';
 denied_=false;begin perform public.dashboard_access_accounts();exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Viewer can list/manage access accounts';
 denied_=false;begin perform public.set_dashboard_full_access(viewer_,false);exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Viewer can change dashboard grants';
 denied_=false;begin perform public.get_dashboard_group_candidates();exception when insufficient_privilege then denied_=true;end;
 assert denied_,'Viewer can open admin grouping manager';
 assert not has_function_privilege('anon','public.sales_dashboard_full_context()','execute'),'Anonymous company dashboard access';
 assert not has_table_privilege('authenticated','public.sales_dashboard_history_cache','update'),'Browser can write cached history';
end $$;
rollback;
