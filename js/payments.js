// ============================================================================
// Banjara — payment abstraction
// ----------------------------------------------------------------------------
// Single entry point: `requestPayment({ orderId, amount, customer })`.
// Returns a Promise that resolves with { ok: true, paymentId, provider } on
// success, or rejects with an Error on cancel/failure.
//
// Implementation dispatches on PAYMENT_MODE in config.js:
//
//   "mock"     → shows an in-page UPI-style overlay with a "Confirm Payment"
//                button. After confirm, calls /api/confirm-mock-payment (or
//                falls back to client-side completion if the serverless
//                function isn't deployed — for static-only previews).
//
//   "razorpay" → loads checkout.razorpay.com, opens the hosted UPI checkout,
//                verifies signature via /api/verify-razorpay-payment.
//                (Wiring stub provided — flip PAYMENT_MODE after env vars
//                are set in Vercel and Razorpay creds are in hand.)
//
// The order MUST already exist in Supabase with payment_status='pending'
// before this is called. The serverless function is what flips it to paid.
// ============================================================================

import { PAYMENT_MODE } from "./config.js";

export async function requestPayment(args) {
  if (PAYMENT_MODE === "razorpay") return requestRazorpay(args);
  return requestMock(args);
}

// ---------- MOCK ------------------------------------------------------------

function requestMock({ orderId, amount, customer }) {
  return new Promise((resolve, reject) => {
    const overlay = buildMockOverlay({ orderId, amount, customer });
    document.body.appendChild(overlay);

    overlay.querySelector("[data-confirm]").addEventListener("click", async () => {
      const btn = overlay.querySelector("[data-confirm]");
      btn.disabled = true;
      btn.textContent = "Verifying…";
      try {
        const res = await fetch("/api/confirm-mock-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        // If the function isn't deployed (static-only preview) we still let
        // the demo flow continue — the order will sit in `pending` until the
        // owner confirms it from admin. The CTA is honest about this.
        let paymentId = "mock_" + Math.random().toString(36).slice(2, 10);
        if (res.ok) {
          const json = await res.json().catch(() => ({}));
          if (json.paymentId) paymentId = json.paymentId;
        }
        overlay.remove();
        resolve({ ok: true, paymentId, provider: "mock" });
      } catch (err) {
        // Network failure — degrade gracefully for the static demo
        overlay.remove();
        resolve({
          ok: true,
          paymentId: "mock_offline_" + Date.now(),
          provider: "mock",
          note: "Payment endpoint unreachable; order created in 'pending' state.",
        });
      }
    });

    overlay.querySelector("[data-cancel]").addEventListener("click", () => {
      overlay.remove();
      reject(new Error("Payment cancelled"));
    });
  });
}

function buildMockOverlay({ orderId, amount, customer }) {
  const el = document.createElement("div");
  el.className = "mock-pay-overlay";
  el.innerHTML = `
    <style>
      .mock-pay-overlay {
        position: fixed; inset: 0; background: rgba(0,0,0,0.85);
        z-index: 2000; display: flex; align-items: center; justify-content: center;
        padding: 20px; backdrop-filter: blur(8px);
      }
      .mock-pay-card {
        max-width: 420px; width: 100%;
        background: #0f0f0f; border: 1px solid rgba(201,169,110,0.25);
        color: var(--cream, #f5f5f5);
        padding: 36px 32px; position: relative;
      }
      .mock-pay-card .ribbon {
        position: absolute; top: -1px; right: -1px;
        background: #c43c3c; color: #fff;
        font-family: 'Cinzel', serif; font-size: 9px; letter-spacing: 3px;
        text-transform: uppercase; padding: 6px 14px;
      }
      .mock-pay-card .upi-mark {
        display: inline-block; padding: 4px 10px; margin-bottom: 14px;
        font-family: 'Cinzel', serif; font-size: 10px; letter-spacing: 4px;
        color: var(--gold, #c9a96e); border: 1px solid rgba(201,169,110,0.35);
        text-transform: uppercase;
      }
      .mock-pay-card h2 {
        font-family: 'Playfair Display', serif; font-size: 1.5rem;
        margin: 8px 0 6px; color: var(--cream, #f5f5f5);
      }
      .mock-pay-card .label {
        font-family: 'Cinzel', serif; font-size: 9px; letter-spacing: 3px;
        color: rgba(245,245,245,0.4); text-transform: uppercase; margin-top: 18px;
      }
      .mock-pay-card .val { font-family: 'Playfair Display', serif; font-size: 1.05rem; color: var(--cream, #f5f5f5); }
      .mock-pay-card .amount {
        font-family: 'Cinzel', serif; font-weight: 700; font-size: 2.4rem;
        color: var(--gold, #c9a96e); margin: 4px 0 0;
      }
      .mock-pay-card .row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(201,169,110,0.08); }
      .mock-pay-card .row:last-child { border-bottom: none; }
      .mock-pay-card .row .k { color: rgba(245,245,245,0.4); font-size: 12px; font-family: 'Cinzel', serif; letter-spacing: 2px; text-transform: uppercase; }
      .mock-pay-card .row .v { color: var(--cream, #f5f5f5); font-family: 'Cormorant Garamond', serif; font-size: 1rem; }
      .mock-pay-card .actions { display: flex; gap: 12px; margin-top: 24px; }
      .mock-pay-card button {
        flex: 1; padding: 14px; cursor: pointer;
        font-family: 'Cinzel', serif; font-size: 10px; letter-spacing: 4px;
        text-transform: uppercase; border: 1px solid;
      }
      .mock-pay-card button[data-confirm] {
        background: var(--gold, #c9a96e); color: #0a0a0a; border-color: var(--gold, #c9a96e);
      }
      .mock-pay-card button[data-confirm]:disabled { opacity: .5; cursor: wait; }
      .mock-pay-card button[data-cancel] {
        background: transparent; color: rgba(245,245,245,0.6);
        border-color: rgba(245,245,245,0.2);
      }
      .mock-pay-card .footnote {
        margin-top: 16px; font-style: italic;
        color: rgba(245,245,245,0.35); font-size: .82rem;
        font-family: 'Cormorant Garamond', serif; line-height: 1.5;
      }
    </style>
    <div class="mock-pay-card">
      <div class="ribbon">Demo Mode</div>
      <div class="upi-mark">UPI · Banjara</div>
      <h2>Confirm Pre-order Payment</h2>
      <div class="amount">₹${Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>

      <div class="label" style="margin-top:24px;">Payment to</div>
      <div class="val">Banjara Gourmet Dining</div>

      <div class="row" style="margin-top:18px;"><span class="k">UPI ID</span><span class="v">banjara@upi</span></div>
      <div class="row"><span class="k">Order</span><span class="v" style="font-family:monospace;font-size:.85rem;">${orderId.slice(0, 8)}…</span></div>
      <div class="row"><span class="k">For</span><span class="v">${(customer && customer.name) || ""}</span></div>

      <div class="actions">
        <button data-cancel>Cancel</button>
        <button data-confirm>Confirm Payment</button>
      </div>
      <div class="footnote">
        This is a demo payment surface. No money is moved. In production this is
        replaced by Razorpay's hosted UPI checkout — same flow, real money.
      </div>
    </div>
  `;
  return el;
}

// ---------- RAZORPAY (deferred) ---------------------------------------------

async function requestRazorpay({ orderId, amount, customer }) {
  // Step 1: ask the server to create a Razorpay order (needs the secret key)
  const r = await fetch("/api/create-razorpay-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, amount }),
  });
  if (!r.ok) throw new Error("Could not initialise payment");
  const { razorpayOrderId, keyId } = await r.json();

  // Step 2: load checkout.js if not already loaded
  await new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load Razorpay"));
    document.head.appendChild(s);
  });

  // Step 3: open the hosted checkout, then verify the signature server-side
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: keyId,
      amount: Math.round(amount * 100),
      currency: "INR",
      name: "Banjara Gourmet Dining",
      description: "Pre-order " + orderId.slice(0, 8),
      order_id: razorpayOrderId,
      prefill: customer
        ? { name: customer.name, email: customer.email, contact: customer.phone }
        : {},
      theme: { color: "#c9a96e" },
      handler: async (resp) => {
        const v = await fetch("/api/verify-razorpay-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          }),
        });
        if (!v.ok) return reject(new Error("Signature verification failed"));
        resolve({ ok: true, paymentId: resp.razorpay_payment_id, provider: "razorpay" });
      },
      modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
    });
    rzp.open();
  });
}
