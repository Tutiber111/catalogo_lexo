alter table public.product_overrides
add column if not exists video_url text not null default '';
