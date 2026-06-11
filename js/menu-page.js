// ============================================================================
// Banjara — menu page renderer
// ----------------------------------------------------------------------------
// Replaces the previously-hardcoded 32-section menu. Renders all active
// categories from Supabase, in order. Each item gets an "Add" button that
// drops it into the cart (see js/cart.js).
//
// Also injects a sticky category jump bar at the top — replaces the old
// 6-tab filter, which didn't scale to data-driven categories.
// ============================================================================

import { fetchMenu } from "./menu-data.js";
import { addItem } from "./cart.js";

const MOUNT = "#menu-root";
const JUMPBAR = "#menu-jumpbar";

function fmtINR(n) {
  return "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function vegDot(isVeg) {
  // small inline SVG so we don't depend on font-awesome variants
  const color = isVeg ? "#4caf50" : "#c43c3c";
  return `<span class="veg-mark" style="
      display:inline-block; width:11px; height:11px; border:1px solid ${color};
      vertical-align: middle; margin-right: 8px; position: relative;">
      <span style="position:absolute;inset:3px;background:${color};border-radius:50%;"></span>
    </span>`;
}

function renderItem(item) {
  const desc = item.description
    ? `<div class="row-desc">${escapeHtml(item.description)}</div>`
    : "";
  return `
    <div class="menu-row" data-item-id="${item.id}">
      <div class="row-left">
        <div class="row-name">${vegDot(item.is_veg)}${escapeHtml(item.name)}</div>
        ${desc}
      </div>
      <div class="row-dots"></div>
      <div class="row-price">${fmtINR(item.price)}</div>
      <button class="row-add"
              data-id="${item.id}"
              data-name="${escapeHtml(item.name)}"
              data-price="${item.price}"
              data-veg="${item.is_veg ? 1 : 0}"
              aria-label="Add ${escapeHtml(item.name)} to order">
        <i class="fas fa-plus"></i>
      </button>
    </div>
  `;
}

function renderCategory(cat) {
  if (!cat.items || cat.items.length === 0) return "";
  return `
    <section class="menu-section-block reveal" id="cat-${cat.slug}">
      <div class="menu-section-heading">${escapeHtml(cat.name)}</div>
      <div class="menu-list">
        ${cat.items.map(renderItem).join("")}
      </div>
    </section>
  `;
}

function renderJumpBar(categories) {
  return categories
    .map((c) => `<a href="#cat-${c.slug}" class="jump-pill">${escapeHtml(c.name)}</a>`)
    .join("");
}

function injectAddButtonStyles() {
  if (document.getElementById("menu-render-styles")) return;
  const css = document.createElement("style");
  css.id = "menu-render-styles";
  css.textContent = `
    /* Add-to-cart button on each menu row */
    .menu-row { position: relative; }
    .menu-row .row-add {
      flex-shrink: 0; width: 34px; height: 34px;
      background: transparent; color: var(--gold, #c9a96e);
      border: 1px solid rgba(201,169,110,0.4);
      cursor: pointer; transition: all .2s ease;
      margin-left: 14px; font-size: 11px;
      display: flex; align-items: center; justify-content: center;
    }
    .menu-row .row-add:hover {
      background: var(--gold, #c9a96e); color: var(--black, #0a0a0a);
    }
    .menu-row .row-add.adding {
      background: #4caf50; color: #fff; border-color: #4caf50;
    }

    /* Sticky jump bar */
    .menu-jumpbar {
      position: sticky; top: 70px; z-index: 50;
      background: rgba(10,10,10,0.92); backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      padding: 14px 24px; margin: 0 -24px 48px;
      border-bottom: 1px solid rgba(201,169,110,0.15);
      border-top: 1px solid rgba(201,169,110,0.08);
      overflow-x: auto; white-space: nowrap;
      scrollbar-width: none;
    }
    .menu-jumpbar::-webkit-scrollbar { display: none; }
    .jump-pill {
      display: inline-block;
      font-family: 'Cinzel', serif; font-size: 9px; letter-spacing: 2.5px;
      color: rgba(245,245,245,0.5); text-transform: uppercase;
      padding: 8px 16px; margin-right: 8px;
      border: 1px solid transparent; text-decoration: none;
      transition: all .2s ease;
    }
    .jump-pill:hover, .jump-pill.active {
      color: var(--gold, #c9a96e);
      border-color: rgba(201,169,110,0.3);
    }

    /* Loading + error states */
    .menu-state {
      text-align: center; padding: 80px 20px;
      color: rgba(245,245,245,0.5);
      font-family: 'Cormorant Garamond', serif; font-style: italic;
      font-size: 1.15rem;
    }
    .menu-state.error { color: #c43c3c; }

    /* Veg mark spacing in row-name */
    .row-name .veg-mark { vertical-align: -1px; }

    @media (max-width: 720px) {
      .menu-jumpbar { top: 60px; padding: 12px 20px; margin: 0 -16px 36px; }
      .menu-row .row-add { width: 30px; height: 30px; }
    }
  `;
  document.head.appendChild(css);
}

function wireScrollSpy(categories) {
  // Highlight the jump-bar pill whose section is currently in view.
  const bar = document.querySelector(JUMPBAR);
  if (!bar) return;
  const pillById = new Map();
  bar.querySelectorAll(".jump-pill").forEach((p) => {
    const id = p.getAttribute("href").slice(1);
    pillById.set(id, p);
  });

  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          pillById.forEach((p) => p.classList.remove("active"));
          const pill = pillById.get(e.target.id);
          if (pill) {
            pill.classList.add("active");
            // Auto-scroll the bar to keep the active pill visible
            pill.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
          }
        }
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );

  categories.forEach((c) => {
    const el = document.getElementById(`cat-${c.slug}`);
    if (el) obs.observe(el);
  });
}

function wireAddButtons() {
  document.querySelector(MOUNT).addEventListener("click", (e) => {
    const btn = e.target.closest(".row-add");
    if (!btn) return;
    addItem({
      id: btn.dataset.id,
      name: btn.dataset.name,
      price: Number(btn.dataset.price),
      is_veg: btn.dataset.veg === "1",
    }, 1);
    // Visual confirmation
    btn.classList.add("adding");
    btn.innerHTML = '<i class="fas fa-check"></i>';
    setTimeout(() => {
      btn.classList.remove("adding");
      btn.innerHTML = '<i class="fas fa-plus"></i>';
    }, 700);
    if (typeof window.__banjaraCartToast === "function") {
      window.__banjaraCartToast(`Added ${btn.dataset.name}`);
    }
  });
}

async function main() {
  injectAddButtonStyles();
  const mount = document.querySelector(MOUNT);
  if (!mount) return;
  mount.innerHTML = `<div class="menu-state">Loading the menu…</div>`;

  try {
    const categories = await fetchMenu();

    if (!categories.length) {
      mount.innerHTML = `<div class="menu-state">The menu is being updated. Please check back shortly.</div>`;
      return;
    }

    const jumpBar = document.querySelector(JUMPBAR);
    if (jumpBar) jumpBar.innerHTML = renderJumpBar(categories);

    mount.innerHTML = categories.map(renderCategory).join("");

    wireAddButtons();
    wireScrollSpy(categories);

    // Honour any existing IntersectionObserver-based reveal animation in the host page
    document.querySelectorAll(`${MOUNT} .reveal`).forEach((el) => el.classList.add("visible"));
  } catch (err) {
    console.error(err);
    mount.innerHTML = `<div class="menu-state error">We couldn't load the menu just now. Please refresh the page in a moment.</div>`;
  }
}

main();
