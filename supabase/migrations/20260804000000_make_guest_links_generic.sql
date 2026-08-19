alter table public.catalog_guest_links
  alter column sales_client_id drop not null,
  alter column salesman_code drop not null;

drop index if exists public.catalog_guest_links_client_idx;

create index if not exists catalog_guest_links_creator_idx
on public.catalog_guest_links (created_by, expires_at desc);
