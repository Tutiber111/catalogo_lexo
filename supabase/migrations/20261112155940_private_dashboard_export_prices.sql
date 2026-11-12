create table private.sales_dashboard_export_prices (
  sku text primary key,
  list_price numeric check (list_price >= 0),
  suggested_price numeric check (suggested_price >= 0),
  ambiguous boolean not null default false,
  by_brand jsonb not null default '{}'::jsonb,
  check (not ambiguous or (list_price is null and suggested_price is null)),
  check (jsonb_typeof(by_brand) = 'object' and (ambiguous or by_brand = '{}'::jsonb))
);

alter table private.sales_dashboard_export_prices enable row level security;
revoke all on private.sales_dashboard_export_prices from public, anon, authenticated;

create function public.sales_dashboard_export_prices() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_full_sales_dashboard() then
    raise exception 'Full dashboard access required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_object_agg(sku, jsonb_build_object(
      'listPrice', list_price,
      'suggestedPrice', suggested_price,
      'ambiguous', ambiguous,
      'byBrand', by_brand
    ))
    from private.sales_dashboard_export_prices
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.sales_dashboard_export_prices() from public, anon;
grant execute on function public.sales_dashboard_export_prices() to authenticated;
