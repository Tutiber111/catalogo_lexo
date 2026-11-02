-- Historical data changes only during an import. Build its exact response once
-- per source statement instead of on every dashboard open/refresh.
create table public.sales_dashboard_history_cache (
 singleton boolean primary key default true check (singleton),
 payload json not null,
 refreshed_at timestamptz not null default now()
);
alter table public.sales_dashboard_history_cache enable row level security;
revoke all on public.sales_dashboard_history_cache from public,anon,authenticated;
grant select on public.sales_dashboard_history_cache to authenticated;
grant all on public.sales_dashboard_history_cache to service_role;
create policy "dashboard history cache admin reader"
 on public.sales_dashboard_history_cache for select to authenticated
 using ((select public.is_admin()));
insert into public.sales_dashboard_history_cache(singleton,payload)
 values(true,'{"available":true,"batches":[],"lines":[]}');

create or replace function private.refresh_dashboard_history_cache() returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Serialize concurrent import statements before taking the source snapshot.
 perform 1 from public.sales_dashboard_history_cache where singleton for update;
 update public.sales_dashboard_history_cache set payload=json_build_object('available',true,
   'batches',coalesce((select json_agg(row_to_json(b)) from (
     select id,source_name,from_date,to_date,warehouse_from_date
     from public.sales_history_batches order by id
   ) b),'[]'::json),
   'lines',coalesce((select json_agg(row_to_json(h)) from (
     select line_key,order_key,order_date,client_code,client_name,sku,product_name,locality,province,
       ordered_qty,invoiced_qty,returned_qty,ordered_net,invoiced_net,batch_id,source_row
     from public.sales_history_lines order by line_key
   ) h),'[]'::json)
 ),refreshed_at=clock_timestamp() where singleton;
end;$$;
revoke all on function private.refresh_dashboard_history_cache() from public,anon,authenticated,service_role;

create or replace function private.dashboard_history_cache_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform private.refresh_dashboard_history_cache();
 return null;
end;$$;
revoke all on function private.dashboard_history_cache_changed() from public,anon,authenticated,service_role;

create trigger dashboard_history_cache_lines
 after insert or update or delete or truncate on public.sales_history_lines
 for each statement execute function private.dashboard_history_cache_changed();
create trigger dashboard_history_cache_batches
 after insert or update or delete or truncate on public.sales_history_batches
 for each statement execute function private.dashboard_history_cache_changed();

select private.refresh_dashboard_history_cache();

-- Preserve the existing endpoint, projection, explicit role check and invoker RLS.
create or replace function public.sales_dashboard_history_json() returns json
language plpgsql stable security invoker set search_path='' as $$
declare result_ json;
begin
 if not exists(select 1 from public.profiles where id=(select auth.uid()) and role::text='admin') then
   raise exception 'Administrator history access required' using errcode='42501';
 end if;
 select payload into strict result_ from public.sales_dashboard_history_cache where singleton;
 return result_;
end;$$;
revoke all on function public.sales_dashboard_history_json() from public,anon;
grant execute on function public.sales_dashboard_history_json() to authenticated;
