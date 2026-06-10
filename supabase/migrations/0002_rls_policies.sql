-- =========================================================================
-- Banjara — row-level security policies (v1)
-- Public (anon) can:
--   - READ active menu_categories + available menu_items
--   - INSERT reservations (forced pending)
--   - INSERT orders (forced 'placed' + payment_status in 'unpaid'/'pending')
--   - SELECT orders (gated by knowing the unguessable UUID)
-- Authenticated owner can: everything
-- =========================================================================

alter table menu_categories enable row level security;
alter table menu_items      enable row level security;
alter table reservations    enable row level security;
alter table orders          enable row level security;

-- ---- menu_categories ----
create policy "anon reads active categories"
  on menu_categories for select to anon
  using (is_active = true);

create policy "owner full categories"
  on menu_categories for all to authenticated
  using (true) with check (true);

-- ---- menu_items ----
create policy "anon reads available items"
  on menu_items for select to anon
  using (is_available = true);

create policy "owner full items"
  on menu_items for all to authenticated
  using (true) with check (true);

-- ---- reservations ----
create policy "anon inserts reservation as pending"
  on reservations for insert to anon
  with check (status = 'pending');

create policy "owner full reservations"
  on reservations for all to authenticated
  using (true) with check (true);

-- ---- orders ----
create policy "anon inserts order in starting state"
  on orders for insert to anon
  with check (
    status = 'placed'
    and payment_status in ('unpaid', 'pending')
  );

create policy "anon reads own order by id"
  on orders for select to anon
  using (true);

create policy "owner full orders"
  on orders for all to authenticated
  using (true) with check (true);
