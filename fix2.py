# Fix 1: Menu inline quantity steppers
menu_js = """// menu-page.js v2
import { fetchMenu } from "./menu-data.js";
import { addItem, getCart, setQty, subscribe } from "./cart.js";

const MOUNT = "#menu-root";
const JUMPBAR = "#menu-jumpbar";
const fmtINR = (n) => "\\u20b9" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);

function vegDot(isVeg) {
  const color = isVeg ? "#4caf50" : "#c43c3c";
  return `<span class="veg-mark" style="display:inline-block;width:11px;height:11px;border:1px solid ${color};vertical-align:middle;margin-right:8px;position:relative;"><span style="position:absolute;inset:3px;background:${color};border-radius:50%;"></span></span>`;
}

function getQty(id) { return (getCart().find(i => i.id === id) || {}).qty || 0; }

function ctrlHtml(id, name, price, veg) {
  const qty = getQty(id);
  if (qty > 0) return `<div class="row-qty-ctrl"><button class="qty-btn" data-id="${id}" data-act="dec">\\u2212</button><span class="qty-num">${qty}</span><button class="qty-btn" data-id="${id}" data-act="inc">+</button></div>`;
  return `<button class="row-add" data-id="${id}" data-name="${escapeHtml(name)}" data-price="${price}" data-veg="${veg?1:0}"><i class="fas fa-plus"></i></button>`;
}

function renderItem(item) {
  const desc = item.description ? `<div class="row-desc">${escapeHtml(item.description)}</div>` : "";
  return `<div class="menu-row" data-item-id="${item.id}" data-item-name="${escapeHtml(item.name)}" data-item-price="${item.price}" data-item-veg="${item.is_veg?1:0}">
    <div class="row-left"><div class="row-name">${vegDot(item.is_veg)}${escapeHtml(item.name)}</div>${desc}</div>
    <div class="row-dots"></div>
    <div class="row-price">${fmtINR(item.price)}</div>
    <div class="row-ctrl">${ctrlHtml(item.id, item.name, item.price, item.is_veg)}</div>
  </div>`;
}

function renderCategory(cat) {
  if (!cat.items || !cat.items.length) return "";
  return `<section class="menu-section-block reveal" id="cat-${cat.slug}"><div class="menu-section-heading">${escapeHtml(cat.name)}</div><div class="menu-list">${cat.items.map(renderItem).join("")}</div></section>`;
}

function renderJumpBar(cats) {
  return cats.map(c => `<a href="#cat-${c.slug}" class="jump-pill">${escapeHtml(c.name)}</a>`).join("");
}

function injectStyles() {
  if (document.getElementById("menu-render-styles")) return;
  const css = document.createElement("style");
  css.id = "menu-render-styles";
  css.textContent = `
    .menu-row { position: relative; align-items: center; }
    .row-dots { top: 0 !important; }
    .row-ctrl { flex-shrink: 0; margin-left: 14px; display: flex; align-items: center; }
    .row-add { width: 34px; height: 34px; background: transparent; color: var(--gold,#c9a96e); border: 1px solid rgba(201,169,110,0.4); cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; font-size: 11px; }
    .row-add:hover { background: var(--gold,#c9a96e); color: #0a0a0a; }
    .row-qty-ctrl { display: inline-flex; align-items: center; border: 1px solid rgba(201,169,110,0.5); }
    .qty-btn { width: 32px; height: 32px; background: transparent; color: var(--gold,#c9a96e); border: none; cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; transition: background .15s; }
    .qty-btn:hover { background: rgba(201,169,110,0.12); }
    .qty-num { min-width: 28px; text-align: center; font-family: 'Cinzel',serif; font-size: 12px; color: var(--cream,#f5f5f5); }
    .menu-jumpbar { position: sticky; top: 70px; z-index: 50; background: rgba(10,10,10,0.92); backdrop-filter: blur(10px); padding: 14px 24px; margin: 0 -24px 48px; border-bottom: 1px solid rgba(201,169,110,0.15); border-top: 1px solid rgba(201,169,110,0.08); overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
    .menu-jumpbar::-webkit-scrollbar { display: none; }
    .jump-pill { display: inline-block; font-family: 'Cinzel',serif; font-size: 9px; letter-spacing: 2.5px; color: rgba(245,245,245,0.5); text-transform: uppercase; padding: 8px 16px; margin-right: 8px; border: 1px solid transparent; text-decoration: none; transition: all .2s; }
    .jump-pill:hover,.jump-pill.active { color: var(--gold,#c9a96e); border-color: rgba(201,169,110,0.3); }
    .menu-state { text-align: center; padding: 80px 20px; color: rgba(245,245,245,0.5); font-family: 'Cormorant Garamond',serif; font-style: italic; font-size: 1.15rem; }
    .menu-state.error { color: #c43c3c; }
    @media (max-width: 720px) { .menu-jumpbar { top: 60px; padding: 12px 20px; margin: 0 -16px 36px; } .qty-btn, .row-add { width: 28px; height: 28px; } }
  `;
  document.head.appendChild(css);
}

function syncControls() {
  const qtyMap = {};
  getCart().forEach(i => { qtyMap[i.id] = i.qty; });
  document.querySelectorAll(".menu-row[data-item-id]").forEach(row => {
    const ctrl = row.querySelector(".row-ctrl");
    if (!ctrl) return;
    ctrl.innerHTML = ctrlHtml(row.dataset.itemId, row.dataset.itemName||"", row.dataset.itemPrice||0, row.dataset.itemVeg==="1");
  });
}

function wireClicks() {
  document.querySelector(MOUNT).addEventListener("click", e => {
    const btn = e.target.closest("[data-act], .row-add");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    const row = btn.closest(".menu-row");
    const act = btn.dataset.act;
    if (!act) {
      addItem({ id, name: btn.dataset.name||(row&&row.dataset.itemName)||"", price: Number(btn.dataset.price||(row&&row.dataset.itemPrice)||0), is_veg: (btn.dataset.veg||(row&&row.dataset.itemVeg))==="1" }, 1);
      if (typeof window.__banjaraCartToast==="function") window.__banjaraCartToast("Added to order");
    } else if (act === "inc") {
      const it = getCart().find(i=>i.id===id); if(it) setQty(id, it.qty+1);
    } else if (act === "dec") {
      const it = getCart().find(i=>i.id===id); if(it) setQty(id, it.qty-1);
    }
  });
}

function wireScrollSpy(cats) {
  const bar = document.querySelector(JUMPBAR);
  if (!bar) return;
  const pills = new Map();
  bar.querySelectorAll(".jump-pill").forEach(p => pills.set(p.getAttribute("href").slice(1), p));
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        pills.forEach(p => p.classList.remove("active"));
        const p = pills.get(e.target.id);
        if (p) { p.classList.add("active"); p.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"}); }
      }
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  cats.forEach(c => { const el = document.getElementById("cat-"+c.slug); if(el) obs.observe(el); });
}

async function main() {
  injectStyles();
  const mount = document.querySelector(MOUNT);
  if (!mount) return;
  mount.innerHTML = '<div class="menu-state">Loading the menu\u2026</div>';
  try {
    const cats = await fetchMenu();
    if (!cats.length) { mount.innerHTML = '<div class="menu-state">The menu is being updated. Please check back shortly.</div>'; return; }
    const jb = document.querySelector(JUMPBAR);
    if (jb) jb.innerHTML = renderJumpBar(cats);
    mount.innerHTML = cats.map(renderCategory).join("");
    wireClicks();
    wireScrollSpy(cats);
    subscribe(syncControls);
    document.querySelectorAll(MOUNT + " .reveal").forEach(el => el.classList.add("visible"));
  } catch(err) {
    console.error(err);
    mount.innerHTML = '<div class="menu-state error">We could not load the menu just now. Please refresh.</div>';
  }
}
main();
"""

with open('js/menu-page.js', 'w', encoding='utf-8') as f:
    f.write(menu_js)
print('Done 1/3: menu-page.js (qty steppers)')

# Fix 2 & 3: CSS for pre-order.html
css = """
    select.form-control optgroup { background: #1a1a1a; color: rgba(201,169,110,0.9); font-style: normal; }
    select.form-control option { background: #0f0f0f; color: #f5f5f5; }
    input[type="date"] { color-scheme: dark; }
    input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.7) sepia(0.3); cursor: pointer; }
"""
c = open('pre-order.html', encoding='utf-8').read()
if 'color-scheme' not in c:
    c = c.replace('</style>', css + '  </style>', 1)
    open('pre-order.html', 'w', encoding='utf-8').write(c)
print('Done 2/3: pre-order.html (optgroup + date picker)')

# Fix 3: CSS for reservation.html
css2 = """
    input[type="date"] { color-scheme: dark; }
    input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.7) sepia(0.3); cursor: pointer; }
"""
c = open('reservation.html', encoding='utf-8').read()
if 'color-scheme' not in c:
    c = c.replace('</style>', css2 + '  </style>', 1)
    open('reservation.html', 'w', encoding='utf-8').write(c)
print('Done 3/3: reservation.html (date picker)')
print('All fixes applied.')