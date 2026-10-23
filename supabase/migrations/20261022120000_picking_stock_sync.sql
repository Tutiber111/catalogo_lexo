-- Picking app (depósito) -> "Sin stock" in this catalog.
-- The picking app's database calls picking_set_stock() when the office confirms that the warehouse has
-- no stock of a product (Oficina › 📦 Sin stock), and again to put it back in stock when the warehouse
-- undoes it. It only puts back products IT marked, and only if nobody edited them here since.
create schema if not exists private;

create table if not exists private.picking_stock_link (
  id integer primary key default 1 check (id = 1),
  secret text not null
);
-- run once with the real secret (not kept in git):
-- insert into private.picking_stock_link (id, secret) values (1, '<secreto compartido: private.catalog_links en la base del depósito>')
-- on conflict (id) do update set secret = excluded.secret;

-- products the picking app marked out of stock (and the version of the row it wrote)
create table if not exists private.picking_stock_marks (
  product_id text primary key,
  marked_at timestamptz not null,
  created_row boolean not null default false
);

create or replace function public.picking_set_stock(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  want boolean := coalesce((p->>'out_of_stock')::boolean, false);
  ids text[];
  n_found integer;
  n_changed integer := 0;
  n integer;
begin
  if coalesce(p->>'secret', '') = '' or not exists (select 1 from private.picking_stock_link where secret = p->>'secret') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  -- the products: by code and the catalog ids the picking app sends (Lexo products live in web/data/catalog.json)
  select array_agg(distinct t.id) into ids from (
    select o.product_id as id from public.product_overrides o
     where upper(replace(o.sku, ' ', '')) in (select upper(replace(x, ' ', '')) from jsonb_array_elements_text(coalesce(p->'skus', '[]'::jsonb)) x)
       and trim(o.sku) <> ''
    union
    select e->>'id' from jsonb_array_elements(coalesce(p->'products', '[]'::jsonb)) e
  ) t where t.id is not null;
  n_found := coalesce(cardinality(ids), 0);
  if n_found = 0 then return jsonb_build_object('found', 0, 'changed', 0); end if;

  if want then
    -- in stock here -> out of stock, remembering we did it
    with upd as (
      update public.product_overrides o set out_of_stock = true, updated_at = now()
       where o.product_id = any(ids) and not o.out_of_stock
      returning o.product_id, o.updated_at
    ), mk as (
      insert into private.picking_stock_marks (product_id, marked_at, created_row)
      select product_id, updated_at, false from upd
      on conflict (product_id) do update set marked_at = excluded.marked_at, created_row = false
      returning 1
    ) select count(*) into n from mk;
    n_changed := n;
    -- products that have never been edited here have no row yet: create it (only "sin stock", nothing else)
    with ins as (
      insert into public.product_overrides (product_id, sku, out_of_stock, ean, updated_at)
      select e->>'id', coalesce(e->>'sku', ''), true, null, now()
        from jsonb_array_elements(coalesce(p->'products', '[]'::jsonb)) e
       where e->>'id' is not null and not exists (select 1 from public.product_overrides o where o.product_id = e->>'id')
      on conflict (product_id) do nothing
      returning product_id, updated_at
    ), mk as (
      insert into private.picking_stock_marks (product_id, marked_at, created_row)
      select product_id, updated_at, true from ins
      on conflict (product_id) do update set marked_at = excluded.marked_at, created_row = true
      returning 1
    ) select count(*) into n from mk;
    n_changed := n_changed + n;
  else
    -- back in stock: only what we marked and nobody touched since
    with upd as (
      update public.product_overrides o set out_of_stock = false, updated_at = now()
        from private.picking_stock_marks m
       where m.product_id = o.product_id and o.product_id = any(ids) and o.out_of_stock and o.updated_at = m.marked_at
      returning o.product_id
    ) select count(*) into n from upd;
    n_changed := n;
    delete from private.picking_stock_marks where product_id = any(ids);
  end if;
  return jsonb_build_object('found', n_found, 'changed', n_changed);
end;
$$;

revoke all on function public.picking_set_stock(jsonb) from public;
grant execute on function public.picking_set_stock(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
