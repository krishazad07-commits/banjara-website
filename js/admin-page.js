// ============================================================================
// Banjara — admin panel
// ----------------------------------------------------------------------------
// Auth-gated single-page app. Three tabs: Menu, Reservations, Orders.
//
// Auth: Supabase Auth (email/password). On a fresh page load we check for an
// existing session. If none, we show the login form. After login we render
// the selected tab.
//
// Menu CRUD: category create/rename/reorder + item create/edit/delete +
// availability toggle. All mutations bust the public menu cache so customers
// see changes within their next page load.
//
// Reservations & orders: list, filter, change status. Status changes are
// optimistic-UI: the row updates immediately, errors revert + show a toast.
// ============================================================================

import { supabase } from "./supabase-client.js";
import { clearMenuCache } from "./menu-data.js";

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const fmtINR = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
};
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// ---------- toast -----------------------------------------------------------

function toast(msg, kind = "ok") {
  const el = $("#admin-toast");
  el.textContent = msg;
  el.dataset.kind = kind;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2400);
}

// ---------- auth ------------------------------------------------------------

async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    showApp(session.user);
  } else {
    showLogin();
  }
}

function showLogin() {
  $("#admin-login").style.display = "flex";
  $("#admin-app").style.display = "none";
}

function showApp(user) {
  $("#admin-login").style.display = "none";
  $("#admin-app").style.display = "";
  $("#admin-user").textContent = user.email;
  // Default to the menu tab
  switchTab("menu");
}

async function login(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const email = form.email.value.trim();
  const password = form.password.value;
  const btn = form.querySelector("button[type=submit]");
  const originalLabel = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> &nbsp;Signing in…';
  const errBox = $("#login-error");
  errBox.hidden = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const { data: { user } } = await supabase.auth.getUser();
    showApp(user);
  } catch (err) {
    errBox.textContent = err.message || "Could not sign in. Check your details and try again.";
    errBox.hidden = false;
    btn.disabled = false;
    btn.innerHTML = originalLabel;
  }
}

async function logout() {
  await supabase.auth.signOut();
  showLogin();
}

// ---------- tabs ------------------------------------------------------------

function switchTab(name) {
  $$(".admin-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".admin-panel").forEach((p) => p.hidden = p.dataset.panel !== name);
  if (name === "menu")         renderMenu();
  if (name === "reservations") renderReservations();
  if (name === "orders")       renderOrders();
}

// ============================================================================
// MENU TAB
// ============================================================================

async function renderMenu() {
  const root = $("#panel-menu");
  root.innerHTML = `<div class="admin-loading">Loading menu…</div>`;

  // Fetch categories + items. We use SELECT '*' here (not the public RLS-filtered
  // version) because as the owner we want to see unavailable items too.
  const { data: cats, error } = await supabase
    .from("menu_categories")
    .select("id, name, slug, sort_order, is_active, items:menu_items(id, name, description, price, is_veg, is_special, is_available, sort_order)")
    .order("sort_order", { ascending: true });

  if (error) {
    root.innerHTML = `<div class="admin-loading error">Could not load menu: ${escapeHtml(error.message)}</div>`;
    return;
  }

  const totalItems = cats.reduce((s, c) => s + (c.items?.length || 0), 0);
  const availableItems = cats.reduce((s, c) => s + (c.items?.filter((i) => i.is_available).length || 0), 0);

  root.innerHTML = `
    <div class="admin-section-head">
      <div>
        <div class="admin-section-title">Menu</div>
        <div class="admin-section-meta">${cats.length} categories · ${availableItems} of ${totalItems} items available</div>
      </div>
      <div class="admin-section-actions">
        <button class="btn-gold-sm" id="add-category"><i class="fas fa-plus"></i> &nbsp;Category</button>
      </div>
    </div>

    <div class="admin-cats">
      ${cats.map((cat) => renderCategoryBlock(cat)).join("")}
    </div>
  `;

  // Wire add category
  $("#add-category").addEventListener("click", onAddCategory);

  // Wire per-category actions
  root.querySelectorAll(".cat-block").forEach((block) => wireCategoryBlock(block, cats));
}

function renderCategoryBlock(cat) {
  const items = (cat.items || []).slice().sort((a, b) => a.sort_order - b.sort_order);
  return `
    <div class="cat-block" data-cat-id="${cat.id}">
      <div class="cat-head">
        <div class="cat-name-wrap">
          <h3 class="cat-name" contenteditable="false">${escapeHtml(cat.name)}</h3>
          <span class="cat-meta">${items.length} items${cat.is_active ? "" : " · hidden"}</span>
        </div>
        <div class="cat-actions">
          <label class="toggle"><input type="checkbox" data-act="toggle-cat" ${cat.is_active ? "checked" : ""}> <span>Active</span></label>
          <button class="btn-ghost-sm" data-act="rename-cat" title="Rename"><i class="fas fa-pen"></i></button>
          <button class="btn-ghost-sm danger" data-act="delete-cat" title="Delete"><i class="fas fa-trash"></i></button>
          <button class="btn-gold-sm" data-act="add-item"><i class="fas fa-plus"></i> &nbsp;Item</button>
        </div>
      </div>
      <div class="cat-items">
        ${items.length === 0
          ? `<div class="cat-empty">No items yet. Add the first one →</div>`
          : items.map((it) => renderItemRow(it)).join("")}
      </div>
    </div>
  `;
}

function renderItemRow(it) {
  return `
    <div class="item-row" data-item-id="${it.id}">
      <div class="item-veg">
        <span class="veg-mark ${it.is_veg ? "veg" : "nonveg"}" title="${it.is_veg ? "Veg" : "Non-veg"}"></span>
      </div>
      <div class="item-main">
        <input class="item-name"  value="${escapeHtml(it.name)}">
        <input class="item-desc"  value="${escapeHtml(it.description || "")}" placeholder="Description (optional)">
      </div>
      <div class="item-price">
        <span class="rupee">₹</span>
        <input class="item-price-input" type="number" inputmode="decimal" step="1" min="0" value="${it.price}">
      </div>
      <div class="item-toggles">
        <label class="toggle"><input type="checkbox" data-act="toggle-veg" ${it.is_veg ? "checked" : ""}><span>Veg</span></label>
        <label class="toggle"><input type="checkbox" data-act="toggle-avail" ${it.is_available ? "checked" : ""}><span>Available</span></label>
      </div>
      <div class="item-actions">
        <button class="btn-gold-sm" data-act="save-item" hidden><i class="fas fa-check"></i> Save</button>
        <button class="btn-ghost-sm danger" data-act="delete-item" title="Delete item"><i class="fas fa-trash"></i></button>
      </div>
    </div>
  `;
}

function wireCategoryBlock(block, cats) {
  const catId = block.dataset.catId;
  const cat = cats.find((c) => c.id === catId);

  block.querySelectorAll(".cat-actions [data-act]").forEach((el) => {
    el.addEventListener(el.tagName === "INPUT" ? "change" : "click", async (e) => {
      const act = el.dataset.act;
      if (act === "toggle-cat") await toggleCategory(catId, el.checked);
      else if (act === "rename-cat") await renameCategory(cat);
      else if (act === "delete-cat") await deleteCategory(cat);
      else if (act === "add-item")  await addItem(cat);
    });
  });

  // Item-level wiring
  block.querySelectorAll(".item-row").forEach((row) => wireItemRow(row));
}

function wireItemRow(row) {
  const itemId = row.dataset.itemId;
  const saveBtn = row.querySelector('[data-act="save-item"]');

  // Mark row dirty on any input change so the Save button appears
  ["input", "change"].forEach((evt) => {
    row.querySelectorAll(".item-name, .item-desc, .item-price-input")
      .forEach((inp) => inp.addEventListener(evt, () => saveBtn.hidden = false));
  });

  // Veg + availability toggles save immediately (no Save button gate)
  row.querySelector('[data-act="toggle-veg"]').addEventListener("change", async (e) => {
    await updateItem(itemId, { is_veg: e.target.checked });
  });
  row.querySelector('[data-act="toggle-avail"]').addEventListener("change", async (e) => {
    await updateItem(itemId, { is_available: e.target.checked });
  });

  saveBtn.addEventListener("click", async () => {
    const patch = {
      name:        row.querySelector(".item-name").value.trim(),
      description: row.querySelector(".item-desc").value.trim() || null,
      price:       parseFloat(row.querySelector(".item-price-input").value) || 0,
    };
    if (!patch.name) { toast("Item name is required", "err"); return; }
    if (patch.price < 0) { toast("Price cannot be negative", "err"); return; }
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving';
    const ok = await updateItem(itemId, patch);
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fas fa-check"></i> Save';
    if (ok) saveBtn.hidden = true;
  });

  row.querySelector('[data-act="delete-item"]').addEventListener("click", async () => {
    const name = row.querySelector(".item-name").value.trim();
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from("menu_items").delete().eq("id", itemId);
    if (error) { toast("Delete failed: " + error.message, "err"); return; }
    clearMenuCache();
    row.remove();
    toast("Item deleted");
  });
}

async function toggleCategory(catId, isActive) {
  const { error } = await supabase
    .from("menu_categories")
    .update({ is_active: isActive })
    .eq("id", catId);
  if (error) return toast("Could not update category: " + error.message, "err");
  clearMenuCache();
  toast(`Category ${isActive ? "shown" : "hidden"}`);
}

async function renameCategory(cat) {
  const newName = prompt("New name for category:", cat.name);
  if (!newName || newName.trim() === cat.name) return;
  const { error } = await supabase
    .from("menu_categories")
    .update({ name: newName.trim() })
    .eq("id", cat.id);
  if (error) return toast("Could not rename: " + error.message, "err");
  clearMenuCache();
  toast("Category renamed");
  renderMenu();
}

async function deleteCategory(cat) {
  if ((cat.items || []).length > 0) {
    return toast("Move or delete all items in this category first", "err");
  }
  if (!confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
  const { error } = await supabase.from("menu_categories").delete().eq("id", cat.id);
  if (error) return toast("Could not delete: " + error.message, "err");
  clearMenuCache();
  toast("Category deleted");
  renderMenu();
}

async function onAddCategory() {
  const name = prompt("Category name (e.g. Specials, Brunch):");
  if (!name || !name.trim()) return;
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  // Compute next sort_order on the client; race conditions don't matter for a single owner
  const { data: max } = await supabase
    .from("menu_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = max ? max.sort_order + 1 : 0;
  const { error } = await supabase
    .from("menu_categories")
    .insert({ name: name.trim(), slug, sort_order: nextSort, is_active: true });
  if (error) return toast("Could not add category: " + error.message, "err");
  clearMenuCache();
  toast("Category added");
  renderMenu();
}

async function addItem(cat) {
  const name = prompt(`New item in "${cat.name}":`);
  if (!name || !name.trim()) return;
  const priceRaw = prompt("Price (₹):", "0");
  const price = parseFloat(priceRaw);
  if (isNaN(price) || price < 0) return toast("Invalid price", "err");
  const items = cat.items || [];
  const nextSort = items.length;
  const { error } = await supabase.from("menu_items").insert({
    category_id: cat.id, name: name.trim(), price, is_veg: true, is_available: true, sort_order: nextSort,
  });
  if (error) return toast("Could not add item: " + error.message, "err");
  clearMenuCache();
  toast("Item added");
  renderMenu();
}

async function updateItem(itemId, patch) {
  const { error } = await supabase.from("menu_items").update(patch).eq("id", itemId);
  if (error) { toast("Save failed: " + error.message, "err"); return false; }
  clearMenuCache();
  toast("Saved");
  return true;
}

// ============================================================================
// RESERVATIONS TAB
// ============================================================================

const RESERVATION_STATUSES = ["pending", "confirmed", "seated", "completed", "cancelled", "no_show"];
const RESERVATION_FILTERS = [
  { key: "upcoming", label: "Upcoming", filter: (q) => q.gte("res_date", new Date().toISOString().split("T")[0]).in("status", ["pending", "confirmed"]) },
  { key: "today",    label: "Today",    filter: (q) => q.eq("res_date", new Date().toISOString().split("T")[0]) },
  { key: "pending",  label: "Pending",  filter: (q) => q.eq("status", "pending") },
  { key: "all",      label: "All",      filter: (q) => q },
];

let resFilterKey = "upcoming";

async function renderReservations() {
  const root = $("#panel-reservations");
  root.innerHTML = `
    <div class="admin-section-head">
      <div>
        <div class="admin-section-title">Reservations</div>
        <div class="admin-section-meta">Manage upcoming bookings and walk-ins</div>
      </div>
      <div class="admin-section-actions">
        ${RESERVATION_FILTERS.map((f) => `
          <button class="filter-pill ${f.key === resFilterKey ? "active" : ""}" data-filter="${f.key}">${f.label}</button>
        `).join("")}
      </div>
    </div>
    <div id="reservations-list"><div class="admin-loading">Loading…</div></div>
  `;

  root.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resFilterKey = btn.dataset.filter;
      renderReservations();
    });
  });

  const list = $("#reservations-list", root);
  let q = supabase.from("reservations")
    .select("id, fname, lname, email, phone, res_date, res_time, guests, seating, occasion, requests, status, order_id, created_at")
    .order("res_date", { ascending: true })
    .order("res_time", { ascending: true });
  q = (RESERVATION_FILTERS.find((f) => f.key === resFilterKey)).filter(q);
  const { data, error } = await q;
  if (error) {
    list.innerHTML = `<div class="admin-loading error">Could not load reservations: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = `<div class="admin-empty">No reservations in this view.</div>`;
    return;
  }

  list.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Date · Time</th><th>Guest</th><th>Party</th><th>Seating</th><th>Status</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map((r) => `
          <tr data-id="${r.id}">
            <td>
              <div class="cell-strong">${new Date(r.res_date).toLocaleDateString("en-IN", { day:"2-digit", month:"short" })} · ${escapeHtml(r.res_time)}</div>
              <div class="cell-sub">Ref ${r.id.slice(0,8)}${r.order_id ? ' · <span style="color:var(--gold);">pre-order</span>' : ""}</div>
            </td>
            <td>
              <div class="cell-strong">${escapeHtml(r.fname)} ${escapeHtml(r.lname)}</div>
              <div class="cell-sub">${escapeHtml(r.email)} · ${escapeHtml(r.phone)}</div>
              ${r.occasion ? `<div class="cell-tag">${escapeHtml(r.occasion)}</div>` : ""}
            </td>
            <td><div class="cell-strong">${r.guests}</div></td>
            <td class="cell-sub">${escapeHtml(r.seating || "—")}</td>
            <td>
              <select class="status-select" data-status>
                ${RESERVATION_STATUSES.map((s) => `<option value="${s}" ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}
              </select>
            </td>
            <td>
              <button class="btn-ghost-sm" data-act="view"><i class="fas fa-eye"></i></button>
            </td>
          </tr>
          ${r.requests ? `<tr class="row-note"><td colspan="6"><strong>Note:</strong> ${escapeHtml(r.requests)}</td></tr>` : ""}
        `).join("")}
      </tbody>
    </table>
  `;

  // Wire status changes
  list.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const row = sel.closest("tr");
      const id = row.dataset.id;
      const newStatus = sel.value;
      const previous = sel.dataset.previous || sel.querySelector("option[selected]")?.value;
      sel.disabled = true;
      const { error } = await supabase
        .from("reservations")
        .update({ status: newStatus })
        .eq("id", id);
      sel.disabled = false;
      if (error) {
        toast("Could not update: " + error.message, "err");
        if (previous) sel.value = previous;
      } else {
        toast(`Marked ${newStatus}`);
        sel.dataset.previous = newStatus;
      }
    });
  });

  // View button — shows the full record in a modal
  list.querySelectorAll('[data-act="view"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest("tr");
      const r = data.find((x) => x.id === row.dataset.id);
      showResDetail(r);
    });
  });
}

function showResDetail(r) {
  const m = $("#admin-modal");
  m.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <div class="modal-eyebrow">Reservation · ${r.id.slice(0,8)}</div>
          <div class="modal-title">${escapeHtml(r.fname)} ${escapeHtml(r.lname)}</div>
        </div>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="kv"><span class="k">Date</span><span class="v">${new Date(r.res_date).toDateString()}</span></div>
        <div class="kv"><span class="k">Time</span><span class="v">${escapeHtml(r.res_time)}</span></div>
        <div class="kv"><span class="k">Guests</span><span class="v">${r.guests}</span></div>
        <div class="kv"><span class="k">Seating</span><span class="v">${escapeHtml(r.seating || "—")}</span></div>
        <div class="kv"><span class="k">Occasion</span><span class="v">${escapeHtml(r.occasion || "—")}</span></div>
        <div class="kv"><span class="k">Email</span><span class="v">${escapeHtml(r.email)}</span></div>
        <div class="kv"><span class="k">Phone</span><span class="v">${escapeHtml(r.phone)}</span></div>
        <div class="kv"><span class="k">Status</span><span class="v">${escapeHtml(r.status)}</span></div>
        <div class="kv"><span class="k">Booked</span><span class="v">${fmtDateTime(r.created_at)}</span></div>
        ${r.requests ? `<div class="kv"><span class="k">Note</span><span class="v">${escapeHtml(r.requests)}</span></div>` : ""}
        ${r.order_id ? `<div class="kv"><span class="k">Pre-order</span><span class="v" style="font-family:monospace;font-size:.85rem;">${r.order_id}</span></div>` : ""}
      </div>
    </div>
  `;
  m.hidden = false;
  m.querySelector(".modal-close").addEventListener("click", () => m.hidden = true);
  m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; });
}

// ============================================================================
// ORDERS TAB
// ============================================================================

const ORDER_STATUSES = ["placed", "preparing", "ready", "completed", "cancelled"];
const ORDER_FILTERS = [
  { key: "active", label: "Active", filter: (q) => q.in("status", ["placed", "preparing", "ready"]) },
  { key: "today",  label: "Today",  filter: (q) => {
    const start = new Date(); start.setHours(0,0,0,0);
    return q.gte("created_at", start.toISOString());
  }},
  { key: "pickup", label: "Pickup", filter: (q) => q.eq("type", "pickup") },
  { key: "table",  label: "Table",  filter: (q) => q.eq("type", "table") },
  { key: "all",    label: "All",    filter: (q) => q },
];

let orderFilterKey = "active";

async function renderOrders() {
  const root = $("#panel-orders");
  root.innerHTML = `
    <div class="admin-section-head">
      <div>
        <div class="admin-section-title">Pre-orders</div>
        <div class="admin-section-meta">Track pickup and table pre-orders, mark progress</div>
      </div>
      <div class="admin-section-actions">
        ${ORDER_FILTERS.map((f) => `
          <button class="filter-pill ${f.key === orderFilterKey ? "active" : ""}" data-filter="${f.key}">${f.label}</button>
        `).join("")}
      </div>
    </div>
    <div id="orders-list"><div class="admin-loading">Loading…</div></div>
  `;

  root.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      orderFilterKey = btn.dataset.filter;
      renderOrders();
    });
  });

  const list = $("#orders-list", root);
  let q = supabase.from("orders")
    .select("id, type, customer_name, customer_email, customer_phone, pickup_time, reservation_id, items, subtotal, total, payment_status, payment_provider, status, notes, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  q = (ORDER_FILTERS.find((f) => f.key === orderFilterKey)).filter(q);
  const { data, error } = await q;
  if (error) {
    list.innerHTML = `<div class="admin-loading error">Could not load orders: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = `<div class="admin-empty">No orders in this view.</div>`;
    return;
  }

  list.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Placed</th><th>Type · Pickup time</th><th>Customer</th><th>Items</th><th>Total · Payment</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${data.map((o) => renderOrderRow(o)).join("")}
      </tbody>
    </table>
  `;

  list.querySelectorAll(".status-select").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const id = sel.closest("tr").dataset.id;
      const newStatus = sel.value;
      sel.disabled = true;
      const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", id);
      sel.disabled = false;
      if (error) toast("Could not update: " + error.message, "err");
      else      toast(`Marked ${newStatus}`);
    });
  });

  list.querySelectorAll('[data-act="view-order"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest("tr").dataset.id;
      const o = data.find((x) => x.id === id);
      showOrderDetail(o);
    });
  });
}

function renderOrderRow(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const itemsText = items.slice(0, 3).map((i) => `${i.qty}× ${escapeHtml(i.name)}`).join(", ")
    + (items.length > 3 ? ` <span style="opacity:.5;">+${items.length - 3} more</span>` : "");
  const payColor = {
    paid: "ok", mock_paid: "ok",
    pending: "warn", unpaid: "warn",
    failed: "err", refunded: "err",
  }[o.payment_status] || "warn";
  return `
    <tr data-id="${o.id}">
      <td><div class="cell-strong">${fmtDateTime(o.created_at)}</div><div class="cell-sub">${o.id.slice(0,8)}</div></td>
      <td>
        <div class="cell-strong">${o.type === "table" ? "With table" : "Pickup"}</div>
        <div class="cell-sub">${escapeHtml(o.pickup_time || (o.reservation_id ? "linked to reservation" : "—"))}</div>
      </td>
      <td>
        <div class="cell-strong">${escapeHtml(o.customer_name)}</div>
        <div class="cell-sub">${escapeHtml(o.customer_phone)}</div>
      </td>
      <td class="cell-sub" style="max-width: 280px;">${itemsText}</td>
      <td>
        <div class="cell-strong">${fmtINR(o.total)}</div>
        <div class="cell-tag tag-${payColor}">${escapeHtml(o.payment_status)}</div>
      </td>
      <td>
        <select class="status-select">
          ${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td><button class="btn-ghost-sm" data-act="view-order"><i class="fas fa-eye"></i></button></td>
    </tr>
  `;
}

function showOrderDetail(o) {
  const m = $("#admin-modal");
  const items = Array.isArray(o.items) ? o.items : [];
  m.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <div>
          <div class="modal-eyebrow">Order · ${o.id.slice(0,8)}</div>
          <div class="modal-title">${escapeHtml(o.customer_name)} · ${o.type === "table" ? "With table" : "Pickup"}</div>
        </div>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="kv"><span class="k">Placed</span><span class="v">${fmtDateTime(o.created_at)}</span></div>
        ${o.pickup_time ? `<div class="kv"><span class="k">Pickup</span><span class="v">${escapeHtml(o.pickup_time)}</span></div>` : ""}
        <div class="kv"><span class="k">Email</span><span class="v">${escapeHtml(o.customer_email)}</span></div>
        <div class="kv"><span class="k">Phone</span><span class="v">${escapeHtml(o.customer_phone)}</span></div>
        <div class="kv"><span class="k">Payment</span><span class="v">${escapeHtml(o.payment_status)} ${o.payment_provider ? "(" + escapeHtml(o.payment_provider) + ")" : ""}</span></div>
        ${o.reservation_id ? `<div class="kv"><span class="k">Reservation</span><span class="v" style="font-family:monospace;font-size:.85rem;">${o.reservation_id}</span></div>` : ""}
        ${o.notes ? `<div class="kv"><span class="k">Notes</span><span class="v">${escapeHtml(o.notes)}</span></div>` : ""}

        <div style="margin-top:24px;">
          <div class="modal-eyebrow">Items</div>
          ${items.map((i) => `
            <div class="kv"><span class="k"><span class="veg-mark ${i.is_veg ? "veg" : "nonveg"}" style="width:9px;height:9px;margin-right:6px;"></span>${i.qty}× ${escapeHtml(i.name)}</span><span class="v">${fmtINR(i.price * i.qty)}</span></div>
          `).join("")}
          <div class="kv" style="border-top: 1px solid rgba(201,169,110,0.2); margin-top:10px; padding-top: 12px;"><span class="k">Subtotal</span><span class="v">${fmtINR(o.subtotal)}</span></div>
          <div class="kv"><span class="k" style="color:var(--gold);">Total</span><span class="v" style="color:var(--gold);font-weight:700;">${fmtINR(o.total)}</span></div>
        </div>
      </div>
    </div>
  `;
  m.hidden = false;
  m.querySelector(".modal-close").addEventListener("click", () => m.hidden = true);
  m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; });
}

// ---------- bootstrap -------------------------------------------------------

$("#admin-login form").addEventListener("submit", login);
$("#admin-logout").addEventListener("click", logout);
$$(".admin-tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") showLogin();
});

checkSession();
