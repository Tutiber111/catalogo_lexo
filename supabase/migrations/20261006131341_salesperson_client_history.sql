-- Read-only access follows the client's CURRENT assigned salesperson.
-- Explicit IDs take precedence; older orders can match by stored client code.
drop policy if exists "orders assigned client history" on public.orders;
create policy "orders assigned client history"
on public.orders for select to authenticated
using (
  exists (
    select 1 from public.sales_clients c
    where c.salesman_code = (select public.current_salesman_code())
      and (
        orders.sales_client_id = c.id
        or (
          orders.sales_client_id is null
          and c.client_code = coalesce(
            nullif(btrim(orders.sales_client_code), ''),
            nullif(btrim(orders.customer_client_code), '')
          )
        )
      )
  )
);

drop policy if exists "order items assigned client history" on public.order_items;
create policy "order items assigned client history"
on public.order_items for select to authenticated
using (
  exists (
    select 1 from public.orders o
    join public.sales_clients c on (
      o.sales_client_id = c.id
      or (
        o.sales_client_id is null
        and c.client_code = coalesce(nullif(btrim(o.sales_client_code), ''), nullif(btrim(o.customer_client_code), ''))
      )
    )
    where o.id = order_items.order_id
      and c.salesman_code = (select public.current_salesman_code())
  )
);
