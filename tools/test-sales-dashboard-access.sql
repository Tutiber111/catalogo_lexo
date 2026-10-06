begin;
do $test$
declare
  actor record;
  expected_orders uuid[];
  actual_orders uuid[];
  expected_items uuid[];
  actual_items uuid[];
begin
  for actor in select id, role, salesman_code from public.profiles loop
    select coalesce(array_agg(o.id order by o.id), '{}'::uuid[]) into expected_orders
    from public.orders o
    where actor.role::text = 'admin' or o.customer_id = actor.id or (
      actor.role::text = 'salesman' and exists (
        select 1 from public.sales_clients c
        where c.salesman_code = actor.salesman_code and (
          o.sales_client_id = c.id or (
            o.sales_client_id is null and c.client_code = coalesce(nullif(btrim(o.sales_client_code), ''), nullif(btrim(o.customer_client_code), ''))
          )
        )
      )
    );
    select coalesce(array_agg(i.id order by i.id), '{}'::uuid[]) into expected_items
    from public.order_items i where i.order_id = any(expected_orders);
    perform set_config('request.jwt.claim.sub', actor.id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', actor.id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select coalesce(array_agg(id order by id), '{}'::uuid[]) into actual_orders from public.orders;
    select coalesce(array_agg(id order by id), '{}'::uuid[]) into actual_items from public.order_items;
    execute 'reset role';
    if actual_orders is distinct from expected_orders then raise exception 'Order isolation mismatch for role %', actor.role; end if;
    if actual_items is distinct from expected_items then raise exception 'Item isolation mismatch for role %', actor.role; end if;
  end loop;
end $test$;
rollback;
select 'All existing profiles passed exact order and item visibility checks' as result;
