-- Keep the HTTP response as JSON text while building large portfolios.
-- The original jsonb endpoint remains available for existing SQL/API callers.
create function public.sales_dashboard_scope_json(
  p_salesman_code text default null,
  p_include_history boolean default true
) returns json
language plpgsql stable security definer set search_path = '' as $$
declare
  caller public.profiles%rowtype;
  target text;
  payload json;
begin
  select * into caller from public.profiles where id = auth.uid();
  if not found or coalesce(caller.role::text, '') not in ('admin', 'salesman') then
    raise exception 'Dashboard access denied' using errcode = '42501';
  end if;

  if caller.role::text = 'salesman' and not caller.dashboard_full_access then
    if coalesce(trim(caller.salesman_code), '') = '' then
      raise exception 'Salesperson code required' using errcode = '42501';
    end if;
    target = case when trim(caller.salesman_code) in ('90', '900') then '900' else trim(caller.salesman_code) end;
    if p_salesman_code is not null and p_salesman_code <> target then
      raise exception 'Portfolio access denied' using errcode = '42501';
    end if;
  else
    target = case when p_salesman_code = '90' then '900' else trim(p_salesman_code) end;
    if target is null or target = '' or target = '*' then
      raise exception 'Choose one salesperson' using errcode = '22023';
    end if;
  end if;

  with scoped_clients as materialized (
    select c.* from public.sales_clients c
    where public.sales_dashboard_assignment(c.client_code, c.salesman_code) = target
  ), scoped_orders as (
    select o.* from public.orders o left join public.sales_clients c
      on case when o.sales_client_id is not null then c.id = o.sales_client_id
        else c.client_code = coalesce(nullif(trim(o.sales_client_code), ''), nullif(trim(o.customer_client_code), '')) end
    where o.status::text not in ('draft', 'cancelled')
      and public.sales_dashboard_assignment(c.client_code, c.salesman_code) = target
  ), history_assignments as materialized (
    -- Resolve the current portfolio once per historical client, including codes
    -- which have never had a sales_clients record.
    select h.client_code, public.sales_dashboard_assignment(h.client_code, c.salesman_code) as salesman_code
    from (select distinct client_code from public.sales_history_lines where p_include_history) h
    left join public.sales_clients c on c.client_code = h.client_code
  ), scoped_history as (
    select h.* from public.sales_history_lines h
    join history_assignments c on c.client_code = h.client_code
    where c.salesman_code = target
  )
  select json_build_object(
    'salesmanCode', target,
    'available', true,
    'clients', coalesce((select json_agg(row_to_json(c) order by c.client_code) from scoped_clients c), '[]'::json),
    'orders', coalesce((select json_agg(row_to_json(o) order by o.created_at, o.id) from (
      select o.*, coalesce((select json_agg(row_to_json(i) order by i.id)
        from public.order_items i where i.order_id = o.id), '[]'::json) as order_items
      from scoped_orders o
    ) o), '[]'::json),
    'batches', case when p_include_history then
      coalesce((select json_agg(row_to_json(b) order by b.id) from public.sales_history_batches b), '[]'::json)
      else '[]'::json end,
    'lines', coalesce((select json_agg(row_to_json(h) order by h.line_key) from scoped_history h), '[]'::json)
  ) into payload;
  return payload;
end;
$$;

revoke all on function public.sales_dashboard_scope_json(text, boolean) from public, anon;
grant execute on function public.sales_dashboard_scope_json(text, boolean) to authenticated, service_role;

-- Preserve the previous SQL return type and permission checks for integrations.
create or replace function public.sales_dashboard_scope(
  p_salesman_code text default null,
  p_include_history boolean default true
) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select public.sales_dashboard_scope_json(p_salesman_code, p_include_history)::jsonb;
$$;

notify pgrst, 'reload schema';
