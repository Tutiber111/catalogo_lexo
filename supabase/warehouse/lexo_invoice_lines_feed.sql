-- WarehousePick only. Run in the warehouse project after review.
-- The existing reader key is required, and the feed exposes only Lexo invoice lines.
begin;

create or replace function public.lexo_invoice_lines_feed(p_order_ids uuid[])
returns table (id uuid, order_id uuid, sku text, name text, qty integer, net_amount numeric)
language plpgsql stable security definer
set search_path = ''
as $function$
declare
  reader_key text := nullif(pg_catalog.current_setting('request.headers', true), '')::json ->> 'x-reader-key';
begin
  if reader_key is null or length(reader_key) < 32 or not exists (
    select 1 from private.reader_keys r
    where r.key_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(reader_key, 'UTF8')), 'hex')
      and r.revoked_at is null
  ) then
    raise exception 'clave de lectura inválida' using errcode = '28000';
  end if;

  if coalesce(cardinality(p_order_ids), 0) not between 1 and 60 then
    raise exception 'Se requieren entre 1 y 60 pedidos' using errcode = '22023';
  end if;

  return query
  select l.id, l.order_id, l.sku, l.name, l.qty_picked,
    l.qty_picked * round(coalesce(l.special_price, l.unit_price) * (1 + coalesce(l.price_adj, 0) / 100), 2)
      * (1 - case when d.discount >= 1 then d.discount / 100 else d.discount end)
  from public.order_lines l
  join public.orders o on o.id = l.order_id
  cross join lateral (
    select case when trim(coalesce(o.erp_header->>'E5', '')) ~ '^[0-9]+([.][0-9]+)?$'
      then (o.erp_header->>'E5')::numeric else 0 end as discount
  ) d
  where o.id = any(p_order_ids) and o.company = 'lexo' and not coalesce(o.is_test, false)
    and o.cancelled_at is null and o.status is distinct from 'cancelled'
    and o.invoiced_at is not null
    and (nullif(trim(o.invoice_number), '') is not null or nullif(trim(o.remito_number), '') is not null)
    and l.qty_picked > 0 and not coalesce(l.no_invoice, false)
    and l.status is distinct from 'nostock' and (l.status in ('picked', 'partial') or l.committed);
end;
$function$;

revoke execute on function public.lexo_invoice_lines_feed(uuid[]) from public;
grant execute on function public.lexo_invoice_lines_feed(uuid[]) to anon, authenticated, service_role;
notify pgrst, 'reload schema';

commit;
