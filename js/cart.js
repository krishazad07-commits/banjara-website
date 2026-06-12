// ============================================================================
// Banjara — cart module
// ----------------------------------------------------------------------------
// Lives in localStorage so the customer's order survives across the menu page
// and the pre-order checkout page. Exposes:
//
//   getCart(), addItem(item, qty), setQty(itemId, qty), removeItem(itemId),
//   clearCart(), totals(), subscribe(fn)
//
// Also auto-injects a floating cart button + slide-in drawer if the host page
// has <body data-cart-ui="auto"> (the menu page does). Other pages (pre-order
// checkout) import the state-only API.
// ============================================================================

const STORAGE_KEY = "banjara-cart-v1";
const listeners = new Set();

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function write(items) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (_) {}
  // also broadcast to other tabs
  listeners.forEach((fn) => { try { fn(items); } catch (_) {} });
}

// Sync between tabs via the 'storage' event
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY) listeners.forEach((fn) => fn(read()));
});

export function getCart() {
  return read();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function addItem(item, qty = 1) {
  // item shape: { id, name, price, is_veg }  (we don't store description in cart)
  const items = read();
  const existing = items.find((i) => i.id === item.id);
  if (existing) {
    existing.qty += qty;
  } else {
    items.push({
      id: item.id,
      name: item.name,
      price: Number(item.price),
      is_veg: !!item.is_veg,
      qty,
    });
  }
  write(items);
}

export function setQty(itemId, qty) {
  const items = read();
  const it = items.find((i) => i.id === itemId);
  if (!it) return;
  if (qty <= 0) {
    write(items.filter((i) => i.id !== itemId));
  } else {
    it.qty = qty;
    write(items);
  }
}

export function removeItem(itemId) {
  write(read().filter((i) => i.id !== itemId));
}

export function clearCart() {
  write([]);
}

export function totals() {
  const items = read();
  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0);
  // Tax not applied to subtotal — restaurant typically shows pre-tax line
  // and applies GST at billing. We surface subtotal only; checkout page can
  // add tax breakdown later.
  return { count, subtotal };
}

// ----------------------------------------------------------------------------
// UI: floating button + drawer. Only mounts if the page opts in.
// ----------------------------------------------------------------------------

function fmtINR(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function mountCartUI() {
  if (document.getElementById("cart-fab")) return;

  // Inject styles (scoped, no class collisions with the existing stylesheet)
  const css = document.createElement("style");
  css.textContent = `
    #cart-fab {
      position: fixed; bottom: 28px; right: 28px; z-index: 1000;
      width: 60px; height: 60px; border-radius: 50%;
      background: var(--gold, #c9a96e); color: var(--black, #0a0a0a);
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      transition: transform .2s ease, opacity .2s ease;
      font-size: 22px;
    }
    #cart-fab:hover { transform: scale(1.05); }
    #cart-fab[hidden] { display: none; }
    #cart-fab .count {
      position: absolute; top: -4px; right: -4px;
      background: #c43c3c; color: #fff;
      border-radius: 12px; min-width: 22px; height: 22px; padding: 0 6px;
      font-family: 'Cinzel', serif; font-size: 11px; letter-spacing: 1px;
      display: flex; align-items: center; justify-content: center;
    }
    #cart-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.65);
      z-index: 1001; opacity: 0; pointer-events: none;
      transition: opacity .25s ease;
    }
    #cart-backdrop.open { opacity: 1; pointer-events: auto; }
    #cart-drawer {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: 100%; max-width: 420px; z-index: 1002;
      background: #0f0f0f; color: var(--cream, #f5f5f5);
      transform: translateX(100%); transition: transform .3s ease;
      display: flex; flex-direction: column;
      border-left: 1px solid rgba(201,169,110,0.15);
    }
    #cart-drawer.open { transform: translateX(0); }
    .cart-head {
      padding: 24px 28px; border-bottom: 1px solid rgba(201,169,110,0.15);
      display: flex; align-items: center; justify-content: space-between;
    }
    .cart-head .title {
      font-family: 'Cinzel', serif; font-size: 11px; letter-spacing: 5px;
      color: var(--gold, #c9a96e); text-transform: uppercase;
    }
    .cart-close {
      background: none; border: none; color: var(--cream, #f5f5f5);
      font-size: 22px; cursor: pointer; line-height: 1;
    }
    .cart-body { flex: 1; overflow-y: auto; padding: 16px 28px; }
    .cart-empty {
      text-align: center; padding: 60px 20px;
      color: rgba(245,245,245,0.4); font-family: 'Cormorant Garamond', serif;
      font-style: italic; font-size: 1.1rem;
    }
    .cart-line {
      padding: 16px 0; border-bottom: 1px solid rgba(201,169,110,0.08);
      display: grid; grid-template-columns: 1fr auto; gap: 8px 12px;
      align-items: center;
    }
    .cart-line:last-child { border-bottom: none; }
    .cart-line .name {
      font-family: 'Playfair Display', serif;
      font-size: 1.05rem; color: var(--cream, #f5f5f5);
      line-height: 1.3;
    }
    .cart-line .veg-dot {
      display: inline-block; width: 9px; height: 9px;
      border: 1px solid; margin-right: 6px; vertical-align: middle;
    }
    .cart-line .veg-dot.veg { border-color: #4caf50; }
    .cart-line .veg-dot.veg::after {
      content: ''; display: block; width: 3px; height: 3px;
      background: #4caf50; border-radius: 50%; margin: 2px auto;
    }
    .cart-line .veg-dot.nonveg { border-color: #c43c3c; }
    .cart-line .veg-dot.nonveg::after {
      content: ''; display: block; width: 3px; height: 3px;
      background: #c43c3c; border-radius: 50%; margin: 2px auto;
    }
    .cart-line .price {
      font-family: 'Cinzel', serif; font-size: 12px; color: rgba(201,169,110,0.85);
      text-align: right; letter-spacing: 1px;
    }
    .cart-line .qty {
      display: inline-flex; align-items: center; gap: 8px;
      border: 1px solid rgba(201,169,110,0.3);
    }
    .cart-line .qty button {
      width: 30px; height: 30px; background: transparent;
      border: none; color: var(--cream, #f5f5f5); cursor: pointer;
      font-size: 14px;
    }
    .cart-line .qty button:hover { background: rgba(201,169,110,0.08); }
    .cart-line .qty .n {
      min-width: 24px; text-align: center;
      font-family: 'Cinzel', serif; font-size: 12px;
    }
    .cart-line .remove {
      background: none; border: none; color: rgba(245,245,245,0.4);
      cursor: pointer; font-size: 11px; letter-spacing: 2px;
      font-family: 'Cinzel', serif; padding: 0; text-transform: uppercase;
    }
    .cart-line .remove:hover { color: #c43c3c; }
    .cart-foot {
      padding: 24px 28px; border-top: 1px solid rgba(201,169,110,0.15);
      background: rgba(201,169,110,0.03);
    }
    .cart-totals {
      display: flex; justify-content: space-between;
      font-family: 'Cinzel', serif; font-size: 11px; letter-spacing: 3px;
      color: var(--cream, #f5f5f5); margin-bottom: 4px;
    }
    .cart-totals.total {
      margin-top: 8px; padding-top: 12px;
      border-top: 1px solid rgba(201,169,110,0.15);
      font-size: 13px; color: var(--gold, #c9a96e);
    }
    .cart-note {
      color: rgba(245,245,245,0.4); font-size: .8rem;
      margin: 14px 0 16px; font-style: italic;
      font-family: 'Cormorant Garamond', serif;
    }
    .cart-checkout {
      display: block; width: 100%; padding: 16px;
      background: var(--gold, #c9a96e); color: var(--black, #0a0a0a);
      border: none; cursor: pointer; text-align: center;
      font-family: 'Cinzel', serif; font-size: 11px; letter-spacing: 4px;
      text-transform: uppercase; text-decoration: none;
    }
    .cart-checkout:hover { background: #d6b97e; }
    .cart-checkout[disabled] { opacity: .4; cursor: not-allowed; }
    .cart-toast {
      position: fixed; bottom: 100px; right: 28px; z-index: 1003;
      background: #0f0f0f; border: 1px solid var(--gold, #c9a96e);
      color: var(--cream, #f5f5f5); padding: 12px 18px;
      font-family: 'Cormorant Garamond', serif; font-size: 14px;
      opacity: 0; transform: translateY(10px);
      transition: opacity .25s, transform .25s; pointer-events: none;
    }
    .cart-toast.show { opacity: 1; transform: translateY(0); }
  `;
  document.head.appendChild(css);

  // Floating button
  const fab = document.createElement("button");
  fab.id = "cart-fab";
  fab.setAttribute("aria-label", "Open cart");
  fab.innerHTML = `<i class="fas fa-shopping-bag"></i><span class="count" hidden>0</span>`;
  document.body.appendChild(fab);

  // Backdrop + drawer
  const backdrop = document.createElement("div");
  backdrop.id = "cart-backdrop";
  document.body.appendChild(backdrop);

  const drawer = document.createElement("aside");
  drawer.id = "cart-drawer";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="cart-head">
      <div class="title">Your Order</div>
      <button class="cart-close" aria-label="Close cart">&times;</button>
    </div>
    <div class="cart-body" id="cart-body"></div>
    <div class="cart-foot" id="cart-foot" hidden>
      <div class="cart-totals"><span>Items</span><span id="cart-count">0</span></div>
      <div class="cart-totals total"><span>Subtotal</span><span id="cart-subtotal">₹0</span></div>
      <div class="cart-note">Taxes calculated at checkout · Final amount confirmed before payment</div>
      <a href="pre-order.html" class="cart-checkout" id="cart-checkout-btn">Continue to Pre-Order &nbsp;→</a>
    </div>
  `;
  document.body.appendChild(drawer);

  // Toast
  const toast = document.createElement("div");
  toast.className = "cart-toast";
  document.body.appendChild(toast);

  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("show"), 1600);
  }
  window.__banjaraCartToast = showToast; // used by menu.html when Add is tapped

  function openDrawer() {
    drawer.classList.add("open");
    backdrop.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    backdrop.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  fab.addEventListener("click", openDrawer);
  backdrop.addEventListener("click", closeDrawer);
  drawer.querySelector(".cart-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
  });

  function render() {
    const items = getCart();
    const { count, subtotal } = totals();
    const fabCount = fab.querySelector(".count");
    fabCount.textContent = String(count);
    fabCount.hidden = count === 0;

    const body = drawer.querySelector("#cart-body");
    const foot = drawer.querySelector("#cart-foot");

    if (items.length === 0) {
      body.innerHTML = `<div class="cart-empty">Your order is empty.<br>Add a dish from the menu to begin.</div>`;
      foot.hidden = true;
      return;
    }

    body.innerHTML = items
      .map((it) => `
        <div class="cart-line" data-id="${it.id}">
          <div>
            <div class="name">
              <span class="veg-dot ${it.is_veg ? "veg" : "nonveg"}"></span>
              ${escapeHtml(it.name)}
            </div>
          </div>
          <div class="price">${fmtINR(it.price * it.qty)}</div>
          <div class="qty">
            <button data-act="dec" aria-label="Decrease">−</button>
            <span class="n">${it.qty}</span>
            <button data-act="inc" aria-label="Increase">+</button>
          </div>
          <button class="remove" data-act="rm">Remove</button>
        </div>
      `).join("");

    foot.hidden = false;
    foot.querySelector("#cart-count").textContent = String(count);
    foot.querySelector("#cart-subtotal").textContent = fmtINR(subtotal);
  }

  body: {
    const body = drawer.querySelector("#cart-body");
    body.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const line = btn.closest(".cart-line");
      const id = line && line.dataset.id;
      if (!id) return;
      const items = getCart();
      const it = items.find((i) => i.id === id);
      if (!it) return;
      const act = btn.dataset.act;
      if (act === "inc") setQty(id, it.qty + 1);
      else if (act === "dec") setQty(id, it.qty - 1);
      else if (act === "rm")  removeItem(id);
    });
  }

  subscribe(render);
  render();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Auto-mount when the body opts in
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (document.body.dataset.cartUi === "auto") mountCartUI();
  });
} else {
  if (document.body.dataset.cartUi === "auto") mountCartUI();
}
