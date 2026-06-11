# Banjara — Handover

This document is for **the restaurant owner and floor staff**. The website is
live, the database is yours, and everything below is what you need to run it
day to day, plus what to give your developer if you ever want to extend it.

---

## What you have

A premium custom website that:
- Shows your full menu (currently 30 categories, 227 items, owner-editable)
- Takes table reservations
- Takes pre-orders for **Pickup** (zero wait) and **with your table** (UPI prepayment)
- Has an owner admin console for managing all of the above
- Lives on Vercel (managed hosting) with the database on Supabase (managed Postgres in Mumbai)

---

## Daily ops — the admin console

URL: `/admin.html` (e.g. `https://banjara.in/admin.html`)

**Login**

| Field | Value |
| --- | --- |
| Email | `owner@banjara.in` |
| Password | `Banjara@2026` |

> ⚠️ **Change this password before going live.** Open the Supabase dashboard
> → Authentication → Users → owner@banjara.in → Reset password. Or ask your
> developer to do it.

**Three tabs**

### Menu

- **Edit an item**: click the name, description, or price — type the change — the **Save** button appears at the right of that row. Click Save.
- **Mark something as 86'd / sold out**: untick **Available** on the row. It disappears from the customer site immediately (within 5 min cache). Tick again when it's back.
- **Mark non-veg**: untick **Veg** on the row. The little dot on the customer site goes red.
- **Add a new item**: in the category you want, click **+ Item**, give it a name and price. Edit description/veg/availability inline after it appears.
- **Delete an item**: trash icon at the right of the row. Confirms before deleting.
- **Add a category**: top of the page, **+ Category**. Pick a name (e.g. "Specials", "Brunch"). It appears immediately on the customer site.
- **Hide a whole category temporarily**: untick **Active** on the category header. Hidden from customers, visible to you.
- **Rename / Delete a category**: pencil / trash icons on the category header. Delete only works if the category is empty — move items out first.

### Reservations

- **Filters** at the top: Upcoming · Today · Pending · All.
- The **Status** dropdown on each row is how you progress a booking:
  - `pending` = customer just submitted, you haven't confirmed
  - `confirmed` = you've accepted it
  - `seated` = they're at the table
  - `completed` = they've finished and left
  - `cancelled` = either side cancelled
  - `no_show` = booked, didn't show
- If the reservation has a **pre-order attached** (food locked in advance), you'll see a gold "pre-order" tag in the ref column.
- Click the eye icon for the full booking detail (notes, occasion, contact info, the linked order id if any).

### Pre-orders

- **Filters**: Active · Today · Pickup · Table · All.
- **Status flow**: `placed` → `preparing` → `ready` → `completed` (or `cancelled`).
- **Payment status pill** (next to the total):
  - 🟢 `mock_paid` / `paid` — money in
  - 🟡 `pending` / `unpaid` — pickup orders pay at pickup; table orders should be `mock_paid` once the customer completes the UPI flow
  - 🔴 `failed` / `refunded`
- Click the eye icon for the full item breakdown.

---

## Payment — DEMO MODE is on

Right now the table pre-order UPI flow says **DEMO MODE** on the payment overlay
and no money moves. Customers see a clean, professional UPI-style page. The
order records get marked `mock_paid`.

**To turn on real payments (Razorpay UPI):**

1. Create a Razorpay account → get **Key ID** and **Key Secret** (live or test).
2. In Vercel → Settings → Environment Variables, add:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `SUPABASE_URL` (already set if mock payments work)
   - `SUPABASE_SERVICE_ROLE_KEY` (already set if mock payments work)
3. In `js/config.js`, change one line: `export const PAYMENT_MODE = "razorpay";`
4. Add a serverless function `api/verify-razorpay-payment.js` that verifies the
   Razorpay HMAC signature server-side (the client-side wiring in
   `js/payments.js` is already complete — it expects this endpoint to exist).
5. Redeploy.

That's it. The customer-facing flow is identical; under the hood, Razorpay's
hosted UPI checkout opens instead of the demo overlay.

---

## How the site is put together

- **Front-end**: plain HTML + ES modules, no build step. Edit any `.html` file
  and refresh.
- **Database**: Supabase project `klrjilcpjxzvcbztpnfp` in `ap-south-1` (Mumbai).
- **Backend functions**: Vercel serverless functions in `/api`.
- **Repo**: GitHub `krishazad07-commits/banjara-website`, branch `full-house`.

### Pages

| Page | What it does |
| --- | --- |
| `/` (index.html) | Marketing homepage |
| `/menu.html` | Full menu, database-driven, customers tap **+** to add to cart |
| `/pre-order.html` | Cart review → mode (Pickup vs Table) → form → payment → confirmation |
| `/reservation.html` | Simple table booking (no food). Upsells pre-order at the top. |
| `/admin.html` | Owner console (login-gated) |
| `/about.html`, `/gallery.html`, `/contact.html` | Static content |

### Database tables

- `menu_categories` — the sections of the menu, ordered
- `menu_items` — every dish, with price + veg + availability
- `reservations` — table bookings
- `orders` — pre-orders (both pickup and table types)

Row-level security is configured so:
- Anyone can read the menu (only the parts you mark active/available)
- Anyone can create a reservation (always lands as `pending`)
- Anyone can create an order (always lands as `placed` + `unpaid`/`pending`)
- **Only the authenticated owner can modify anything**

---

## Deploying changes

If you (or a developer) edit anything and want it live:

```bash
git add -A
git commit -m "Updated copy on About page"
git push origin full-house
```

Vercel auto-deploys on push if the GitHub repo is connected. If it isn't yet:

1. Go to vercel.com → New Project → Import `krishazad07-commits/banjara-website`.
2. Set Production Branch to `full-house` (or merge to `main` first if preferred).
3. Add the environment variables from `.env.example`.
4. Deploy.

---

## When you forget your password

1. Open Supabase dashboard → Authentication → Users.
2. Find `owner@banjara.in` → click the menu → "Send password recovery email"
   OR "Reset password" directly.

If you've also lost access to the Supabase dashboard — only the original
project owner (the developer who set this up) can recover that.

---

## Things to add when the budget allows

These are deliberately not built yet — they're add-ons listed in the original
catalogue or natural next steps:

- **Email confirmations** for reservations and paid orders (Resend, 30 min of
  developer work — endpoint stub is already there in `js/payments.js`).
- **Photography** to populate `menu_items.image_url` (the column exists; the
  customer site is ready to render images per item).
- **SMS confirmations** on `+91 …` for table bookings.
- **Loyalty / repeat-customer tagging** — see if the same phone has booked before.

---

## Who built this

THEKULTHOUSE — Boutique creative studio, Ahmedabad. `thekulthouse.in@gmail.com`.
