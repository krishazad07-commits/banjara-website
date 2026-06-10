-- =========================================================================
-- Banjara — initial schema (v1)
-- Applied via Supabase MCP on project klrjilcpjxzvcbztpnfp.
-- Re-runnable on fresh databases; do NOT re-apply on existing prod.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---------- menu_categories ----------
create table menu_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------- menu_items ----------
create table menu_items (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references menu_categories(id) on delete restrict,
  name          text not null,
  description   text,
  price         numeric(10,2) not null check (price >= 0),
  is_veg        boolean not null default true,
  is_special    boolean not null default false,
  is_available  boolean not null default true,
  sort_order    int  not null default 0,
  image_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index menu_items_category_idx on menu_items(category_id, sort_order);
create index menu_items_available_idx on menu_items(is_available) where is_available = true;

-- ---------- reservations ----------
create type reservation_status as enum ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show');

create table reservations (
  id            uuid primary key default gen_random_uuid(),
  fname         text not null,
  lname         text not null,
  email         text not null,
  phone         text not null,
  res_date      date not null,
  res_time      text not null,
  guests        int  not null check (guests > 0 and guests <= 50),
  seating       text,
  occasion      text,
  requests      text,
  status        reservation_status not null default 'pending',
  order_id      uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index reservations_date_idx on reservations(res_date, res_time);
create index reservations_status_idx on reservations(status);

-- ---------- orders ----------
create type order_type     as enum ('pickup', 'table');
create type payment_status as enum ('unpaid', 'pending', 'paid', 'failed', 'refunded', 'mock_paid');
create type order_status   as enum ('placed', 'preparing', 'ready', 'completed', 'cancelled');

create table orders (
  id                   uuid primary key default gen_random_uuid(),
  type                 order_type not null,
  customer_name        text not null,
  customer_email       text not null,
  customer_phone       text not null,
  pickup_time          text,
  reservation_id       uuid references reservations(id) on delete set null,
  items                jsonb not null,
  subtotal             numeric(10,2) not null check (subtotal >= 0),
  total                numeric(10,2) not null check (total >= 0),
  payment_status       payment_status not null default 'unpaid',
  payment_provider     text,
  payment_order_id     text,
  payment_id           text,
  status               order_status not null default 'placed',
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index orders_reservation_idx on orders(reservation_id);
create index orders_payment_status_idx on orders(payment_status);
create index orders_created_idx on orders(created_at desc);

alter table reservations
  add constraint reservations_order_id_fkey
  foreign key (order_id) references orders(id) on delete set null;

create or replace function set_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

create trigger menu_items_updated_at    before update on menu_items    for each row execute function set_updated_at();
create trigger reservations_updated_at  before update on reservations  for each row execute function set_updated_at();
create trigger orders_updated_at        before update on orders        for each row execute function set_updated_at();
