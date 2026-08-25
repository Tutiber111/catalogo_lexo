drop index if exists public.orders_client_request_id_unique;
create unique index orders_client_request_id_unique
on public.orders (client_request_id);

drop index if exists public.order_items_client_line_unique;
create unique index order_items_client_line_unique
on public.order_items (order_id, client_line_number);

notify pgrst, 'reload schema';
