alter table public.profiles
  add column if not exists client_code text not null default '';

alter table public.orders
  add column if not exists customer_client_code text not null default '';

create unique index if not exists profiles_client_code_unique
on public.profiles (client_code)
where client_code is not null and client_code <> '';
