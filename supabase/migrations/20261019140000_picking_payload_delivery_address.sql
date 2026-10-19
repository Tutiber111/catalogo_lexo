-- The picking app also receives the delivery address (as the order email writes it: "dirección - localidad"),
-- so its "Excel para el ERP" is complete.
create or replace function private.picking_order_payload(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'externalOrderId', o.id,
    'externalOrderNumber', o.order_number,
    'externalCreatedAt', o.created_at,
    'clientCode', coalesce(nullif(o.sales_client_code, ''), nullif(o.customer_client_code, ''), ''),
    'clientNameSnapshot', coalesce(nullif(o.sales_client_name, ''), o.customer_name),
    'observations', o.notes,
    'transport', o.order_transport,
    'deliveryHours', o.delivery_hours,
    'deliveryAddress', case when nullif(o.branch_name, '') is not null
      then coalesce(nullif(concat_ws(' - ', nullif(o.branch_address, ''), nullif(o.branch_locality, '')), ''), o.branch_name)
      else concat_ws(' - ', nullif(o.sales_client_address, ''), nullif(o.sales_client_locality, '')) end,
    'branch', case when nullif(o.branch_name, '') is null then null else jsonb_build_object(
      'name', o.branch_name, 'address', o.branch_address, 'locality', o.branch_locality) end,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'sku', i.sku, 'productNameSnapshot', i.name, 'quantity', i.quantity, 'ean', i.ean)
        order by i.client_line_number nulls last, i.created_at, i.id)
      from public.order_items i where i.order_id = o.id), '[]'::jsonb)
  )
  from public.orders o where o.id = p_order_id;
$$;
