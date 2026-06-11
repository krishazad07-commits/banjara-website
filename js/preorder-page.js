// ============================================================================
// Banjara — pre-order checkout
// ----------------------------------------------------------------------------
// State machine:
//   cart        → review items, choose mode, "Continue"
//   form        → customer info + mode-specific fields, "Continue to pay" / "Place order"
//   paying      → payment overlay (table mode only)
//   done        → confirmation, order id, copy link
//
// Cart is read from js/cart.js. Order is written directly to Supabase from the
// browser using the anon key + RLS (which forces status='placed' and
// payment_status in 'unpaid'/'pending'). Payment confirmation is then
// dispatched through js/payments.js, which depending on PAYMENT_MODE either
// shows the mock UPI overlay or opens Razorpay.
// ============================================================================

import { supabase } from "./supabase-client.js";
import { getCart, clearCart, setQty, removeItem, totals, subscribe } from "./cart.js";
import { requestPayment } from "./payments.js";
import { RESTAURANT } from "./config.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmtINR = (n) =>
  "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

// Single source of truth for which view is on
const state = {
  view: "cart",            // 'cart' | 'form' | 'paying' | 'done'
  mode: "pickup",          // 'pickup' | 'table'
  order: null,             // { id } once created
};

// ---------- view: cart ------------------------------------------------------

function renderCart() {
  const items = getCart();
  const { count, subtotal } = totals();
  const view = $("#view-cart");

  if (items.length === 0) {
    view.innerHTML = `
      <div class="check-empty">
        <i class="fas fa-utensils" style="font-size: 32px; color: var(--gold); margin-bottom: 18px; display: block;"></i>
        <h2 class="font-playfair" style="font-size: 1.6rem; color: var(--cream);">Your order is empty</h2>
        <p style="color: rgba(245,245,245,0.45); margin: 10px 0 28px;">Browse the menu and tap the <i class="fas fa-plus" style="font-size:.85rem;color:var(--gold);"></i> on any dish to begin.</p>
        <a href="menu.html" class="btn-gold">View the Menu &nbsp;→</a>
      </div>
    `;
    return;
  }

  view.innerHTML = `
    <div class="check-step-label">Step 1 of 3 · Review</div>
    <h1 class="font-playfair check-h1">Your <em>Pre-order</em></h1>
    <div class="divider" style="margin: 18px 0 30px;"><span class="divider-icon">◆</span></div>

    <div class="check-lines">
      ${items.map((it) => `
        <div class="check-line" data-id="${it.id}">
          <div class="check-line-main">
            <div class="check-line-name">
              <span class="veg-mark ${it.is_veg ? "veg" : "nonveg"}"></span>
              ${escapeHtml(it.name)}
            </div>
            <div class="check-line-price">${fmtINR(it.price)} × ${it.qty}</div>
          </div>
          <div class="check-line-qty">
            <button data-act="dec" aria-label="Decrease">−</button>
            <span class="n">${it.qty}</span>
            <button data-act="inc" aria-label="Increase">+</button>
            <button class="check-rm" data-act="rm" aria-label="Remove">Remove</button>
          </div>
          <div class="check-line-total">${fmtINR(it.price * it.qty)}</div>
        </div>
      `).join("")}
    </div>

    <div class="check-summary">
      <div class="check-summary-row">
        <span>Items</span>
        <span class="v">${count}</span>
      </div>
      <div class="check-summary-row total">
        <span>Subtotal</span>
        <span class="v">${fmtINR(subtotal)}</span>
      </div>
      <p class="check-note">
        Taxes calculated at checkout · Final amount confirmed before payment
      </p>
    </div>

    <div class="check-mode">
      <div class="check-mode-label">How would you like this?</div>
      <div class="check-mode-grid">
        <label class="check-mode-card ${state.mode === "pickup" ? "selected" : ""}">
          <input type="radio" name="mode" value="pickup" ${state.mode === "pickup" ? "checked" : ""}>
          <div class="check-mode-card-inner">
            <i class="fas fa-shopping-bag"></i>
            <div class="check-mode-title">Pickup</div>
            <div class="check-mode-sub">We have it ready when you walk in. Pay on collection.</div>
          </div>
        </label>
        <label class="check-mode-card ${state.mode === "table" ? "selected" : ""}">
          <input type="radio" name="mode" value="table" ${state.mode === "table" ? "checked" : ""}>
          <div class="check-mode-card-inner">
            <i class="fas fa-chair"></i>
            <div class="check-mode-title">With your Table</div>
            <div class="check-mode-sub">Reserve a table and lock the meal. Prepay by UPI · table held.</div>
          </div>
        </label>
      </div>
    </div>

    <div class="check-actions">
      <a href="menu.html" class="btn-ghost"><i class="fas fa-arrow-left"></i> &nbsp;Back to menu</a>
      <button id="to-form" class="btn-gold">Continue &nbsp;→</button>
    </div>
  `;

  // Wire qty + remove
  view.querySelector(".check-lines").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const id = btn.closest(".check-line").dataset.id;
    const it = getCart().find((x) => x.id === id);
    if (!it) return;
    const a = btn.dataset.act;
    if (a === "inc") setQty(id, it.qty + 1);
    else if (a === "dec") setQty(id, it.qty - 1);
    else if (a === "rm")  removeItem(id);
  });

  // Wire mode radios
  view.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.addEventListener("change", () => {
      state.mode = r.value;
      $$(".check-mode-card").forEach((c) => c.classList.toggle("selected", c.contains(r)));
    });
  });

  $("#to-form").addEventListener("click", () => {
    state.view = "form";
    show();
  });
}

// ---------- view: form ------------------------------------------------------

function timeSlots() {
  // Lunch + dinner half-hours, matches the reservation page
  return [
    { label: "Lunch", slots: ["12:00 PM","12:30 PM","1:00 PM","1:30 PM","2:00 PM","2:30 PM","3:00 PM"] },
    { label: "Dinner", slots: ["7:00 PM","7:30 PM","8:00 PM","8:30 PM","9:00 PM","9:30 PM","10:00 PM"] },
  ];
}

function renderForm() {
  const view = $("#view-form");
  const { subtotal } = totals();
  const today = new Date().toISOString().split("T")[0];
  const isTable = state.mode === "table";
  const prepayAmount = subtotal * RESTAURANT.tablePrepayRatio;

  view.innerHTML = `
    <div class="check-step-label">Step 2 of 3 · Your details</div>
    <h1 class="font-playfair check-h1">
      ${isTable ? "Reserve & <em>prepay</em>" : "Your <em>pickup</em> details"}
    </h1>
    <div class="divider" style="margin: 18px 0 24px;"><span class="divider-icon">◆</span></div>

    <p class="check-mode-summary">
      <i class="fas fa-${isTable ? "chair" : "shopping-bag"}"></i>
      <strong>${isTable ? "With your table" : "Pickup"}</strong>
      &nbsp;·&nbsp; <a href="#" id="change-mode">change</a>
    </p>

    <form id="check-form" novalidate>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">First Name *</label>
          <input class="form-control" required name="fname" placeholder="Arjun">
        </div>
        <div class="form-group">
          <label class="form-label">Last Name *</label>
          <input class="form-control" required name="lname" placeholder="Mehta">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Email *</label>
        <input class="form-control" required type="email" name="email" placeholder="arjun@example.com">
      </div>
      <div class="form-group">
        <label class="form-label">Phone *</label>
        <input class="form-control" required type="tel" name="phone" placeholder="+91 98765 43210">
      </div>

      ${isTable ? `
        <div class="divider" style="margin: 12px 0 18px;"><span class="divider-icon">◆</span></div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Date *</label>
            <input class="form-control" required type="date" name="date" min="${today}">
          </div>
          <div class="form-group">
            <label class="form-label">Time *</label>
            <select class="form-control" required name="time">
              <option value="" disabled selected>Select time</option>
              ${timeSlots().map((g) => `
                <optgroup label="${g.label}">${g.slots.map((s) => `<option>${s}</option>`).join("")}</optgroup>
              `).join("")}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Guests *</label>
            <select class="form-control" required name="guests">
              <option value="" disabled selected>Select guests</option>
              ${Array.from({length: 10}, (_,i)=>i+1).map((n) => `<option>${n} Guest${n===1?"":"s"}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Seating Preference</label>
            <select class="form-control" name="seating">
              <option value="">No preference</option>
              <option>Indoor — Main Hall</option>
              <option>Indoor — Private Alcove</option>
              <option>Near Window</option>
              <option>Private Dining Room</option>
            </select>
          </div>
        </div>
      ` : `
        <div class="divider" style="margin: 12px 0 18px;"><span class="divider-icon">◆</span></div>
        <div class="form-group">
          <label class="form-label">Pickup Time *</label>
          <select class="form-control" required name="pickup_time">
            <option value="" disabled selected>Select pickup time</option>
            ${timeSlots().map((g) => `
              <optgroup label="${g.label}">${g.slots.map((s) => `<option>${s}</option>`).join("")}</optgroup>
            `).join("")}
          </select>
          <div class="form-hint">Today or later · Allow ${RESTAURANT.pickupLeadMinutes} minutes from order time</div>
        </div>
      `}

      <div class="form-group">
        <label class="form-label">Notes for the kitchen</label>
        <textarea class="form-control" rows="3" name="notes" placeholder="Dietary requirements, allergies, special requests…" style="resize: vertical; font-family: 'Cormorant Garamond', serif; font-size: 17px;"></textarea>
      </div>

      <div class="check-pay-summary">
        <div class="check-summary-row total">
          <span>${isTable ? "Prepayment" : "Pay at pickup"}</span>
          <span class="v">${fmtINR(isTable ? prepayAmount : subtotal)}</span>
        </div>
        ${isTable
          ? `<p class="check-note">
              Prepaid via UPI · Locks your table and meal · Refunded in full
              if you cancel 4+ hours before. Demo mode active — no money moved.
            </p>`
          : `<p class="check-note">
              Pay when you collect · Your dishes will be ready at your chosen time
            </p>`
        }
      </div>

      <div id="form-error" class="check-error" hidden>
        <i class="fas fa-exclamation-circle"></i>
        <span class="msg">Please complete all required fields.</span>
      </div>

      <div class="check-actions">
        <button type="button" id="back-cart" class="btn-ghost"><i class="fas fa-arrow-left"></i> &nbsp;Back</button>
        <button type="submit" class="btn-gold" id="submit-order">
          ${isTable
            ? `Continue to UPI · ${fmtINR(prepayAmount)} &nbsp;→`
            : `Place pickup order &nbsp;→`}
        </button>
      </div>
    </form>
  `;

  $("#back-cart").addEventListener("click", () => { state.view = "cart"; show(); });
  $("#change-mode").addEventListener("click", (e) => { e.preventDefault(); state.view = "cart"; show(); });
  $("#check-form").addEventListener("submit", onSubmit);
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const err = $("#form-error");
  err.hidden = true;

  // Native validity
  if (!form.checkValidity()) {
    err.querySelector(".msg").textContent = "Please complete all required fields.";
    err.hidden = false;
    form.reportValidity();
    return;
  }

  // Cart still has items?
  const items = getCart();
  if (items.length === 0) {
    err.querySelector(".msg").textContent = "Your cart is empty. Add items from the menu first.";
    err.hidden = false;
    return;
  }

  const { subtotal } = totals();
  const isTable = state.mode === "table";

  const submitBtn = $("#submit-order");
  const originalLabel = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> &nbsp;Working…`;

  try {
    // ---- For table mode, write the reservation first
    let reservationId = null;
    if (isTable) {
      const { data: resRow, error: resErr } = await supabase
        .from("reservations")
        .insert({
          fname: data.fname,
          lname: data.lname,
          email: data.email,
          phone: data.phone,
          res_date: data.date,
          res_time: data.time,
          guests: parseInt(data.guests, 10) || 1,
          seating: data.seating || null,
          requests: data.notes || null,
          status: "pending",
        })
        .select("id")
        .single();
      if (resErr) throw resErr;
      reservationId = resRow.id;
    }

    // ---- Create the order row
    const total = isTable
      ? subtotal * RESTAURANT.tablePrepayRatio
      : subtotal;

    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert({
        type: isTable ? "table" : "pickup",
        customer_name: `${data.fname} ${data.lname}`.trim(),
        customer_email: data.email,
        customer_phone: data.phone,
        pickup_time: isTable ? null : (data.pickup_time || null),
        reservation_id: reservationId,
        items: items.map((it) => ({
          item_id: it.id,
          name: it.name,
          price: it.price,
          qty: it.qty,
          is_veg: it.is_veg,
        })),
        subtotal: subtotal,
        total: total,
        payment_status: isTable ? "pending" : "unpaid",
        payment_provider: isTable ? "mock" : null,
        status: "placed",
        notes: data.notes || null,
      })
      .select("id")
      .single();
    if (orderErr) throw orderErr;

    state.order = { id: orderRow.id, reservationId, mode: state.mode, amount: total };

    // ---- If with-table, also link the order back into the reservation row
    if (reservationId) {
      // Best-effort; ignore failure (RLS doesn't allow anon UPDATE on reservations
      // — that's intentional. The owner can see both rows in admin via the
      // reservation_id FK on orders.)
      await supabase
        .from("reservations")
        .update({ order_id: orderRow.id })
        .eq("id", reservationId);
    }

    // ---- Payment step
    if (isTable) {
      state.view = "paying";
      show();
      try {
        const pay = await requestPayment({
          orderId: orderRow.id,
          amount: total,
          customer: { name: `${data.fname} ${data.lname}`, email: data.email, phone: data.phone },
        });
        state.order.paymentId = pay.paymentId;
        state.order.paymentNote = pay.note;
      } catch (payErr) {
        // Customer cancelled or it failed. Order remains in 'pending' — owner can
        // chase or cancel it from admin. Bring them back to the form with a clear note.
        state.view = "form";
        show();
        const e2 = $("#form-error");
        e2.querySelector(".msg").textContent =
          "Payment was not completed. Your order is held; retry when ready.";
        e2.hidden = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalLabel;
        return;
      }
    }

    // Clear cart only AFTER a successful end-to-end create (and payment, if needed)
    clearCart();
    state.view = "done";
    show();
  } catch (e) {
    console.error(e);
    err.querySelector(".msg").textContent =
      "Something went wrong while saving your order. Please try again.";
    err.hidden = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalLabel;
  }
}

// ---------- view: paying (placeholder shell — overlay is rendered by js/payments.js) ----------

function renderPaying() {
  $("#view-paying").innerHTML = `
    <div class="check-step-label">Step 3 of 3 · Payment</div>
    <h1 class="font-playfair check-h1">Awaiting <em>UPI confirmation</em>…</h1>
    <div class="divider" style="margin: 18px 0 30px;"><span class="divider-icon">◆</span></div>
    <p style="color: var(--cream-dim);">Complete the payment in the window above to lock your table.</p>
  `;
}

// ---------- view: done ------------------------------------------------------

function renderDone() {
  const o = state.order || {};
  const isTable = o.mode === "table";
  $("#view-done").innerHTML = `
    <div class="check-done-icon"><i class="fas fa-check"></i></div>
    <div class="check-step-label" style="text-align:center; justify-content:center;">Pre-order Received</div>
    <h1 class="font-playfair check-h1" style="text-align:center;">
      Thank You — we have your <em>order</em>.
    </h1>
    <div class="divider" style="justify-content: center; margin: 18px auto 28px;"><span class="divider-icon">◆</span></div>
    <p style="text-align:center; color: var(--cream-dim); max-width: 480px; margin: 0 auto;">
      ${isTable
        ? `Your table is locked and the kitchen has your selection. We'll send a confirmation email shortly.`
        : `Your pickup is logged. The kitchen will have your dishes ready at your chosen time. A confirmation email is on its way.`}
    </p>

    <div class="check-done-card">
      <div class="row"><span class="k">Order ID</span><span class="v" style="font-family: monospace; font-size: .85rem;">${o.id || "—"}</span></div>
      <div class="row"><span class="k">Type</span><span class="v">${isTable ? "With your table" : "Pickup"}</span></div>
      <div class="row"><span class="k">Amount</span><span class="v">${fmtINR(o.amount || 0)}</span></div>
      ${o.paymentId ? `<div class="row"><span class="k">Payment</span><span class="v" style="font-family: monospace; font-size: .85rem;">${o.paymentId}</span></div>` : ""}
      ${o.paymentNote ? `<div class="row" style="border-bottom: none;"><span class="k">Note</span><span class="v" style="font-style: italic; opacity:.7;">${escapeHtml(o.paymentNote)}</span></div>` : ""}
    </div>

    <div class="check-actions" style="justify-content:center;">
      <a href="menu.html" class="btn-ghost">View menu</a>
      <a href="index.html" class="btn-gold">Back to Banjara</a>
    </div>
  `;
}

// ---------- view switcher ---------------------------------------------------

function show() {
  $$(".check-view").forEach((v) => v.hidden = true);
  const id = "#view-" + state.view;
  const el = $(id);
  if (!el) return;
  el.hidden = false;

  if (state.view === "cart") renderCart();
  else if (state.view === "form") renderForm();
  else if (state.view === "paying") renderPaying();
  else if (state.view === "done") renderDone();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Live cart updates while user is on the cart view (e.g. drawer changes)
subscribe(() => {
  if (state.view === "cart") renderCart();
});

show();
