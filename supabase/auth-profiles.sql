-- ============================================================
-- Supabase Auth: profiles + orders.user_id + RLS
-- Run in Supabase SQL Editor after existing order RLS migrations.
--
-- In Supabase Dashboard → Authentication → URL configuration, add:
--   Site URL: http://localhost:3000 (and your production URL)
--   Redirect URLs: http://localhost:3000/auth/callback
--                  https://YOUR_DOMAIN/auth/callback
-- ============================================================

-- 1) Profiles (linked to auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'customer' check (role in ('customer', 'staff', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- New user signup → profile row
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

-- 2) Link orders to logged-in customers (optional)
alter table public.orders
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists idx_orders_user_id on public.orders (user_id);

-- 3) Replace blanket deny on orders/order_items for authenticated users
drop policy if exists "service_role_only_orders" on public.orders;
drop policy if exists "orders_anon_none" on public.orders;
drop policy if exists "orders_select_own" on public.orders;

create policy "orders_anon_none"
  on public.orders for all
  to anon
  using (false)
  with check (false);

create policy "orders_select_own"
  on public.orders for select
  to authenticated
  using (user_id is not null and auth.uid() = user_id);

drop policy if exists "service_role_only_order_items" on public.order_items;
drop policy if exists "order_items_anon_none" on public.order_items;
drop policy if exists "order_items_select_own" on public.order_items;

create policy "order_items_anon_none"
  on public.order_items for all
  to anon
  using (false)
  with check (false);

create policy "order_items_select_own"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id is not null
        and o.user_id = auth.uid()
    )
  );

-- 4) Promote your first admin (replace email):
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'you@example.com' limit 1);

comment on table public.profiles is 'App user profile; role customer | admin.';
