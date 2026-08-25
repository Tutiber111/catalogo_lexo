create or replace function public.claim_erp_order_exports(p_limit integer default 10)
returns table (
  export_id uuid,
  order_id uuid,
  lease_token uuid,
  payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select queue.id
    from public.erp_order_exports queue
    where (
      (
        queue.status in ('pending', 'retry-scheduled')
        and queue.next_attempt_at <= now()
      ) or (
        queue.status = 'processing'
        and queue.lease_expires_at < now()
      )
    )
    and exists (
      select 1
      from public.order_items items
      where items.order_id = queue.order_id
    )
    order by queue.created_at, queue.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
  ), claimed as (
    update public.erp_order_exports queue
    set
      status = 'processing',
      attempt_count = queue.attempt_count + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes',
      updated_at = now()
    from candidates
    where queue.id = candidates.id
    returning queue.*
  )
  select
    claimed.id,
    claimed.order_id,
    claimed.lease_token,
    jsonb_build_object(
      'sourceSystem', 'lexo-catalog',
      'externalOrderId', orders.id,
      'externalOrderNumber', orders.order_number,
      'externalCreatedAt', orders.created_at,
      'clientRequestId', orders.client_request_id,
      'clientRequestHash', orders.client_request_hash,
      'clientCode', coalesce(nullif(orders.sales_client_code, ''), nullif(orders.customer_client_code, '')),
      'clientNameSnapshot', coalesce(nullif(orders.sales_client_name, ''), orders.customer_name),
      'address', coalesce(nullif(orders.branch_address, ''), orders.sales_client_address),
      'locality', coalesce(nullif(orders.branch_locality, ''), orders.sales_client_locality),
      'transport', orders.order_transport,
      'observations', orders.notes,
      'salesmanCodeSnapshot', orders.salesman_code,
      'branchOrderGroupId', orders.branch_order_group_id,
      'clientBranchId', orders.client_branch_id,
      'branch', case
        when orders.client_branch_id is null and nullif(orders.branch_name, '') is null then null
        else jsonb_build_object(
          'id', orders.client_branch_id,
          'name', orders.branch_name,
          'address', orders.branch_address,
          'locality', orders.branch_locality
        )
      end,
      'totalItemsSnapshot', orders.total_items,
      'totalValueSnapshot', orders.total_value,
      'lines', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'externalLineId', items.id,
            'lineNumber', items.client_line_number,
            'sku', items.sku,
            'productNameSnapshot', items.name,
            'quantity', items.quantity,
            'unitPrice', items.unit_price,
            'lineTotalSnapshot', items.line_total
          )
          order by items.client_line_number nulls last, items.created_at, items.id
        )
        from public.order_items items
        where items.order_id = orders.id
      ), '[]'::jsonb)
    )
  from claimed
  join public.orders orders on orders.id = claimed.order_id
  where exists (
    select 1 from public.order_items items where items.order_id = orders.id
  );
end;
$$;

revoke all on function public.claim_erp_order_exports(integer) from public, anon, authenticated;
grant execute on function public.claim_erp_order_exports(integer) to service_role;
