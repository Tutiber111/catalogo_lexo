create table if not exists public.catalog_guest_links (
  id uuid primary key default gen_random_uuid(),
  sales_client_id uuid not null references public.sales_clients(id) on delete cascade,
  salesman_code text not null references public.salesmen(code),
  created_by uuid not null references public.profiles(id) on delete cascade,
  link_token_hash text not null unique,
  otp_hash text not null,
  session_token_hash text not null default '',
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  last_attempt_at timestamptz,
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_guest_links_session_token_idx
on public.catalog_guest_links (session_token_hash)
where session_token_hash <> '';

create unique index if not exists catalog_guest_links_session_token_unique_idx
on public.catalog_guest_links (session_token_hash)
where session_token_hash <> '';

create index if not exists catalog_guest_links_client_idx
on public.catalog_guest_links (sales_client_id, salesman_code, expires_at desc);

alter table public.catalog_guest_links enable row level security;
