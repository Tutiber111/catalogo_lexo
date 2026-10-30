-- Additive optimized endpoint: preserve the original function and all caller RLS.
create function public.sales_dashboard_history_json() returns json
language plpgsql stable security invoker set search_path='' as $$
declare result_ json;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='admin') then
   raise exception 'Administrator history access required' using errcode='42501';
 end if;
 select json_build_object('available',true,
   'batches',coalesce((select json_agg(row_to_json(b)) from (
     select id,source_name,from_date,to_date,warehouse_from_date from public.sales_history_batches order by id
   ) b),'[]'::json),
   'lines',coalesce((select json_agg(row_to_json(h)) from (
     select line_key,order_key,order_date,client_code,client_name,sku,product_name,locality,province,
       ordered_qty,invoiced_qty,returned_qty,ordered_net,invoiced_net,batch_id,source_row
     from public.sales_history_lines order by line_key
   ) h),'[]'::json)
 ) into result_;
 return result_;
end;$$;
revoke all on function public.sales_dashboard_history_json() from public,anon;
grant execute on function public.sales_dashboard_history_json() to authenticated;
