create table public.account_carts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  items jsonb not null default '{}'::jsonb,
  constraint account_cart_items_valid check (
    jsonb_typeof(items) = 'object'
    and not jsonb_path_exists(items, '$.* ? (@.type() != "number" || @ < 1 || @ > 9007199254740991 || @ != @.floor())')
  )
);

alter table public.account_carts enable row level security;
revoke all on public.account_carts from public, anon, authenticated;
grant select, insert, update on public.account_carts to authenticated;

create policy account_carts_owner_select on public.account_carts
  for select to authenticated using (user_id = (select auth.uid()));

create policy account_carts_owner_insert on public.account_carts
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy account_carts_owner_update on public.account_carts
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Apply only edited products so a stale device cannot replace the whole cart.
-- Initial browser contents are eligible only when the account has no cart row yet.
create function public.update_account_cart(
  p_user_id uuid,
  p_changes jsonb,
  p_initial_items jsonb default '{}'::jsonb
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  insert into public.account_carts (user_id, items)
  values (p_user_id, jsonb_strip_nulls(p_initial_items || p_changes))
  on conflict (user_id) do update
    set items = jsonb_strip_nulls(account_carts.items || p_changes)
  returning items;
$$;

revoke all on function public.update_account_cart(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.update_account_cart(uuid, jsonb, jsonb) to authenticated;
