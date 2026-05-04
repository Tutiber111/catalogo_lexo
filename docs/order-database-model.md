# Order Database Model

## Recommended Host

Use Supabase for the first production version.

Reasons:
- It gives us Postgres, authentication, and row-level security in one place.
- Customers can log in from the public catalog and only see their own orders.
- Admin users can see every order through policy-controlled access.
- It works well with Netlify static hosting because the browser can call Supabase directly for normal customer actions, while Netlify Functions can handle sensitive admin/server tasks later.

Neon is also a good Postgres host, but it would require adding a separate auth layer and API sooner. Firebase is workable, but the order data is relational enough that Postgres is a cleaner fit.

## Core Tables

```sql
create type user_role as enum ('customer', 'admin');
create type order_status as enum ('draft', 'placed', 'confirmed', 'packed', 'sent', 'cancelled');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'customer',
  name text not null,
  phone text,
  company text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id),
  order_number bigint generated always as identity,
  status order_status not null default 'placed',
  customer_name text not null,
  customer_phone text,
  notes text,
  total_items integer not null default 0,
  total_value numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id text not null,
  sku text not null,
  name text not null,
  unit_price numeric(12, 2) not null,
  quantity integer not null check (quantity > 0),
  line_total numeric(12, 2) not null,
  page integer,
  created_at timestamptz not null default now()
);

create table catalog_adjustments (
  product_id text primary key,
  name text,
  category text,
  price numeric(12, 2),
  hidden boolean not null default false,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
```

## Access Rules

Enable row-level security on all app tables.

Policies:
- Customers can read and update their own `profiles` row.
- Customers can insert orders with `customer_id = auth.uid()`.
- Customers can read their own orders and order items.
- Admin users can read and update all orders, profiles, and catalog adjustments.
- Only admins can change order status or catalog adjustments.

## Login Flow

Customer:
1. Signs in with email/password or magic link.
2. Profile pre-fills name, phone, and company in the cart.
3. Saved orders go to Supabase instead of `localStorage`.
4. Customer account page lists their previous orders.

Admin:
1. Signs in with an admin account.
2. Admin popup reads all orders from Supabase.
3. Admin can filter by customer, status, date, SKU, or order number.
4. Admin can update order status.

## Migration Path From Current Prototype

1. Keep the current `localStorage` admin as a fallback for local demos.
2. Add Supabase configuration keys to Netlify environment variables.
3. Replace `CATALOG_STORE.loadOrders()` / `addOrder()` with async Supabase calls.
4. Replace password-only admin with Supabase Auth and an admin role.
5. Add a customer orders view inside the catalog.
