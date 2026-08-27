create table if not exists public.order_email_attachments (
  order_id uuid primary key references public.orders(id) on delete cascade,
  filename text not null,
  content_base64 text not null,
  content_type text not null default 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_email_attachments enable row level security;

revoke all on table public.order_email_attachments from anon, authenticated;
grant select, insert, update, delete on table public.order_email_attachments to service_role;

comment on table public.order_email_attachments is
  'Private short-lived cache for order workbooks while grouped order emails are assembled.';
