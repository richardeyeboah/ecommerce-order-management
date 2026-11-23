-- Commerce reliability baseline: explicit tax classes, immutable tax snapshots,
-- and transactional Stripe fulfillment. Apply to staging before production.

begin;

alter table public.products
  add column if not exists tax_class text,
  add column if not exists stock_quantity integer;

create or replace function public.products_sync_in_stock_from_qty()
returns trigger language plpgsql as $$
begin
  if new.stock_quantity is not null then
    new.in_stock := new.stock_quantity > 0;
  end if;
  return new;
end;
$$;
drop trigger if exists products_sync_in_stock_trg on public.products;
create trigger products_sync_in_stock_trg
  before insert or update of stock_quantity on public.products
  for each row execute function public.products_sync_in_stock_from_qty();

alter table public.products
  drop constraint if exists products_tax_class_check;
alter table public.products
  add constraint products_tax_class_check
  check (tax_class is null or tax_class in ('grocery_exempt', 'taxable_general', 'alcohol'));

alter table public.orders
  add column if not exists tax_rate numeric(8,6) not null default 0,
  add column if not exists taxable_subtotal numeric(10,2) not null default 0,
  add column if not exists tax_jurisdiction text,
  add column if not exists inventory_restocked_at timestamptz,
  add column if not exists tip_amount numeric(10,2) not null default 0,
  add column if not exists substitution_pref text,
  add column if not exists pickup_slot text;

alter table public.order_items
  add column if not exists product_category text,
  add column if not exists tax_class text;

alter table public.order_items
  drop constraint if exists order_items_tax_class_check;
alter table public.order_items
  add constraint order_items_tax_class_check
  check (tax_class is null or tax_class in ('grocery_exempt', 'taxable_general', 'alcohol'));

create table if not exists public.order_status_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_at timestamptz not null default now(),
  changed_by text,
  note text
);

create or replace function public.protect_profiles_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    new.role := 'customer';
  elsif old.role is distinct from new.role then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profiles_role_trigger on public.profiles;
create trigger protect_profiles_role_trigger
  before insert or update on public.profiles
  for each row execute function public.protect_profiles_role();

drop policy if exists "users can submit reviews" on public.product_reviews;
drop policy if exists "authenticated users can submit own reviews" on public.product_reviews;
create policy "authenticated users can submit own reviews"
  on public.product_reviews for insert to authenticated
  with check (auth.uid() = user_id and approved = false);

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on table public.schema_migrations from anon, authenticated;

create unique index if not exists orders_stripe_payment_intent_id_key
  on public.orders(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_logs enable row level security;
alter table public.checkout_snapshots enable row level security;
revoke insert, update, delete, truncate, references, trigger
  on table public.orders, public.order_items, public.order_status_logs
  from anon, authenticated;
revoke all on table public.checkout_snapshots from anon, authenticated;

create or replace function public.create_paid_order_atomic(
  p_payment_intent_id text,
  p_order jsonb,
  p_items jsonb,
  p_log_note text default 'Paid via Stripe Payment Element'
)
returns table(order_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item_count integer;
begin
  if nullif(trim(p_payment_intent_id), '') is null then
    raise exception 'payment_intent_id is required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'at least one order item is required';
  end if;

  select id into v_order_id
  from public.orders
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  if v_order_id is not null then
    select count(*) into v_item_count
    from public.order_items
    where order_items.order_id = v_order_id;

    if v_item_count > 0 then
      return query select v_order_id, false;
      return;
    end if;
  else
    insert into public.orders (
      customer_name, customer_email, customer_phone, address_line, city, state,
      country, postal_code, subtotal_amount, shipping_fee, tax_amount, tax_rate,
      taxable_subtotal, tax_jurisdiction, shipping_method, shipping_zone,
      total_amount, status, ordered_at, payment_method, user_id,
      stripe_checkout_session_id, stripe_payment_intent_id, pickup_contact_name,
      tip_amount, substitution_pref, pickup_slot
    ) values (
      p_order->>'customer_name',
      p_order->>'customer_email',
      p_order->>'customer_phone',
      p_order->>'address_line',
      p_order->>'city',
      nullif(p_order->>'state', ''),
      p_order->>'country',
      nullif(p_order->>'postal_code', ''),
      (p_order->>'subtotal_amount')::numeric,
      (p_order->>'shipping_fee')::numeric,
      (p_order->>'tax_amount')::numeric,
      coalesce((p_order->>'tax_rate')::numeric, 0),
      coalesce((p_order->>'taxable_subtotal')::numeric, 0),
      nullif(p_order->>'tax_jurisdiction', ''),
      p_order->>'shipping_method',
      nullif(p_order->>'shipping_zone', ''),
      (p_order->>'total_amount')::numeric,
      'ordered',
      coalesce((p_order->>'ordered_at')::timestamptz, now()),
      'stripe',
      nullif(p_order->>'user_id', '')::uuid,
      null,
      p_payment_intent_id,
      nullif(p_order->>'pickup_contact_name', ''),
      coalesce((p_order->>'tip_amount')::numeric, 0),
      coalesce(nullif(p_order->>'substitution_pref', ''), 'refund'),
      nullif(p_order->>'pickup_slot', '')
    )
    returning id into v_order_id;
  end if;

  insert into public.order_items (
    order_id, product_id, product_name, product_price, quantity, subtotal,
    product_category, tax_class
  )
  select
    v_order_id,
    nullif(item->>'product_id', '')::uuid,
    item->>'product_name',
    (item->>'product_price')::numeric,
    (item->>'quantity')::integer,
    (item->>'subtotal')::numeric,
    nullif(item->>'product_category', ''),
    nullif(item->>'tax_class', '')
  from jsonb_array_elements(p_items) item;

  update public.products p
  set stock_quantity = greatest(0, p.stock_quantity - sold.quantity)
  from (
    select
      nullif(item->>'product_id', '')::uuid as product_id,
      sum((item->>'quantity')::integer) as quantity
    from jsonb_array_elements(p_items) item
    group by 1
  ) sold
  where p.id = sold.product_id
    and p.stock_quantity is not null;

  insert into public.order_status_logs (
    order_id, from_status, to_status, changed_by, note
  ) values (
    v_order_id, null, 'ordered', 'stripe_webhook', left(p_log_note, 500)
  );

  return query select v_order_id, true;
end;
$$;

revoke all on function public.create_paid_order_atomic(text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.create_paid_order_atomic(text, jsonb, jsonb, text)
  to service_role;

create or replace function public.restock_order_inventory(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select id into v_order_id
  from public.orders
  where id = p_order_id and inventory_restocked_at is null
  for update;

  if v_order_id is null then
    return false;
  end if;

  update public.products p
  set stock_quantity = p.stock_quantity + returned.quantity
  from (
    select product_id, sum(quantity)::integer as quantity
    from public.order_items
    where order_id = p_order_id and product_id is not null
    group by product_id
  ) returned
  where p.id = returned.product_id
    and p.stock_quantity is not null;

  update public.orders
  set inventory_restocked_at = now()
  where id = p_order_id;
  return true;
end;
$$;

revoke all on function public.restock_order_inventory(uuid)
  from public, anon, authenticated;
grant execute on function public.restock_order_inventory(uuid)
  to service_role;

insert into public.schema_migrations(version)
values ('20261122220000_commerce_reliability')
on conflict (version) do nothing;

commit;
