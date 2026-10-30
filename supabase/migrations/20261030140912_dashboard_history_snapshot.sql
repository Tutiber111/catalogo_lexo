-- One protected request replaces paged historical downloads for the admin dashboard.
-- SECURITY INVOKER preserves the existing history RLS and browser SELECT grants.
create function public.sales_dashboard_history() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result_ jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and role::text='admin') then
   raise exception 'Administrator history access required' using errcode='42501';
 end if;
 select jsonb_build_object('available',true,
   'batches',coalesce((select jsonb_agg(to_jsonb(b)) from (
     select id,source_name,from_date,to_date,warehouse_from_date from public.sales_history_batches order by id
   ) b),'[]'::jsonb),
   'lines',coalesce((select jsonb_agg(to_jsonb(h)) from (
     select line_key,order_key,order_date,client_code,client_name,sku,product_name,locality,province,
       ordered_qty,invoiced_qty,returned_qty,ordered_net,invoiced_net,batch_id,source_row
     from public.sales_history_lines order by line_key
   ) h),'[]'::jsonb)
 ) into result_;
 return result_;
end;$$;
revoke all on function public.sales_dashboard_history() from public,anon;
grant execute on function public.sales_dashboard_history() to authenticated;
