-- ============================================================
-- Kintampo African Market — one-shot bootstrap for a NEW project
-- Dashboard → SQL Editor → paste all → Run
-- Project: qppnaxvwslwlsvsdwhvp
-- Safe to re-run (IF NOT EXISTS / drop policy if exists).
-- ============================================================

-- 1) Products (public catalog) -----------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  price       numeric(10,2) not null,
  category    text not null,
  image_url   text,
  image_urls  text[] not null default '{}',
  in_stock    boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.products enable row level security;

drop policy if exists "Public can view products" on public.products;
create policy "Public can view products"
  on public.products for select
  using (true);

-- 2) Orders + items ----------------------------------------------------------
create table if not exists public.orders (
  id                         uuid primary key default gen_random_uuid(),
  customer_name              text not null,
  customer_email             text not null,
  customer_phone             text,
  address_line               text not null,
  city                       text not null,
  state                      text,
  country                    text not null default 'United States',
  postal_code                text,
  subtotal_amount            numeric(10,2) not null default 0,
  shipping_fee               numeric(10,2) not null default 0,
  tax_amount                 numeric(10,2) not null default 0,
  shipping_method            text not null default 'standard',
  shipping_zone              text,
  total_amount               numeric(10,2) not null,
  status                     text not null default 'ordered',
  payment_method             text not null default 'stripe',
  user_id                    uuid references auth.users(id) on delete set null,
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  pickup_contact_name        text,
  tracking_number            text,
  admin_note                 text,
  refunded_at                timestamptz,
  refund_amount              numeric,
  refund_stripe_id           text,
  ordered_at                 timestamptz,
  processing_at              timestamptz,
  shipped_at                 timestamptz,
  out_for_delivery_at        timestamptz,
  delivered_at               timestamptz,
  cancelled_at               timestamptz,
  created_at                 timestamptz not null default now()
);

create table if not exists public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    uuid references public.products(id),
  product_name  text not null,
  product_price numeric(10,2) not null,
  quantity      int not null,
  subtotal      numeric(10,2) not null
);

create unique index if not exists orders_stripe_checkout_session_id_key
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists orders_stripe_payment_intent_id_key
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists idx_orders_user_id on public.orders (user_id);

create sequence if not exists orders_order_number_seq start 1001;
alter table public.orders
  add column if not exists order_number bigint;
update public.orders
set order_number = nextval('orders_order_number_seq')
where order_number is null;
alter table public.orders
  alter column order_number set default nextval('orders_order_number_seq');
alter table public.orders
  alter column order_number set not null;
create unique index if not exists orders_order_number_unique on public.orders(order_number);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Anyone can place orders" on public.orders;
drop policy if exists "Anyone can insert order items" on public.order_items;
drop policy if exists "service_role_only_orders" on public.orders;
drop policy if exists "service_role_only_order_items" on public.order_items;
drop policy if exists "orders_anon_none" on public.orders;
drop policy if exists "orders_select_own" on public.orders;
drop policy if exists "order_items_anon_none" on public.order_items;
drop policy if exists "order_items_select_own" on public.order_items;

create policy "orders_anon_none"
  on public.orders for all to anon
  using (false) with check (false);

create policy "orders_select_own"
  on public.orders for select to authenticated
  using (user_id is not null and auth.uid() = user_id);

create policy "order_items_anon_none"
  on public.order_items for all to anon
  using (false) with check (false);

create policy "order_items_select_own"
  on public.order_items for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id is not null
        and o.user_id = auth.uid()
    )
  );

-- 3) Profiles ----------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  marketing_opt_in boolean default false,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = id);
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Reviews + wishlist ------------------------------------------------------
create table if not exists public.product_reviews (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  reviewer_name text not null,
  rating        smallint not null check (rating between 1 and 5),
  comment       text,
  approved      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists product_reviews_product_id_idx
  on public.product_reviews(product_id);

alter table public.product_reviews enable row level security;

drop policy if exists "approved reviews are public" on public.product_reviews;
drop policy if exists "users can submit reviews" on public.product_reviews;
create policy "approved reviews are public" on public.product_reviews
  for select using (approved = true);
create policy "users can submit reviews" on public.product_reviews
  for insert with check (true);

create table if not exists public.wishlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique(user_id, product_id)
);

alter table public.wishlists enable row level security;
drop policy if exists "users manage own wishlist" on public.wishlists;
create policy "users manage own wishlist" on public.wishlists
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5) Addresses + status logs -------------------------------------------------
create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  full_name text not null,
  phone text,
  line1 text not null,
  line2 text,
  city text not null,
  state text not null,
  country text not null default 'United States',
  postal_code text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists addresses_user_idx on public.addresses(user_id);
alter table public.addresses enable row level security;
drop policy if exists "addresses_owner_select" on public.addresses;
create policy "addresses_owner_select" on public.addresses
  for select using (auth.uid() = user_id);
drop policy if exists "addresses_owner_insert" on public.addresses;
create policy "addresses_owner_insert" on public.addresses
  for insert with check (auth.uid() = user_id);
drop policy if exists "addresses_owner_update" on public.addresses;
create policy "addresses_owner_update" on public.addresses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "addresses_owner_delete" on public.addresses;
create policy "addresses_owner_delete" on public.addresses
  for delete using (auth.uid() = user_id);

create table if not exists public.order_status_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now(),
  changed_by text,
  note text
);

create index if not exists order_status_logs_order_idx
  on public.order_status_logs(order_id, changed_at desc);

alter table public.order_status_logs enable row level security;
drop policy if exists "service_role_only_order_status_logs" on public.order_status_logs;
create policy "service_role_only_order_status_logs"
  on public.order_status_logs for all to anon, authenticated
  using (false) with check (false);

-- 8) Checkout snapshots (Stripe Payment Element) -----------------------------
create table if not exists public.checkout_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  payload jsonb not null,
  payment_intent_id text,
  created_at timestamptz not null default now()
);

create index if not exists checkout_snapshots_user_id_idx
  on public.checkout_snapshots (user_id);

create index if not exists checkout_snapshots_payment_intent_id_idx
  on public.checkout_snapshots (payment_intent_id);

alter table public.checkout_snapshots enable row level security;

revoke all on table public.checkout_snapshots from anon, authenticated;

drop policy if exists "deny all non-service-role access to checkout_snapshots"
  on public.checkout_snapshots;

create policy "deny all non-service-role access to checkout_snapshots"
  on public.checkout_snapshots
  for all
  to public
  using (false)
  with check (false);

-- Done ----------------------------------------------------------------------
select 'bootstrap ok' as status,
  (select count(*) from public.products) as products;
