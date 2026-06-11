// ============================================================================
// POST /api/confirm-mock-payment
// ----------------------------------------------------------------------------
// Body: { orderId: uuid }
// Effect: flips orders.payment_status from 'pending' → 'mock_paid' using the
// SERVICE ROLE key (which bypasses RLS). Customer-side code cannot perform
// this update — that's the whole point of having a server endpoint here.
//
// When real Razorpay credentials are provisioned, this file is REPLACED (or
// kept alongside) by /api/verify-razorpay-payment.js which validates the
// HMAC signature returned by Razorpay before updating to 'paid'.
//
// Environment variables required (set in Vercel project → Settings → Env):
//   SUPABASE_URL                — https://klrjilcpjxzvcbztpnfp.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — from Supabase project → Settings → API
//                                 (NEVER commit this; it bypasses RLS)
// ============================================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({
      error: "Server not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env.",
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (_) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { orderId } = body;
  if (!orderId || typeof orderId !== "string") {
    return res.status(400).json({ error: "orderId is required" });
  }

  const paymentId = "mock_" + Math.random().toString(36).slice(2, 12);

  // PATCH the orders row, scoped to one id, asserting it's currently 'pending'
  // (defence-in-depth — we don't want to re-confirm an order that was already
  // paid or cancelled).
  const patchRes = await fetch(
    `${url}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&payment_status=eq.pending`,
    {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        payment_status: "mock_paid",
        payment_provider: "mock",
        payment_id: paymentId,
      }),
    }
  );

  if (!patchRes.ok) {
    const detail = await patchRes.text();
    return res.status(502).json({ error: "Could not update order", detail });
  }

  const rows = await patchRes.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(409).json({
      error: "Order is not in a 'pending' state — already confirmed or cancelled.",
    });
  }

  // If the order is linked to a reservation, confirm that too
  const reservationId = rows[0].reservation_id;
  if (reservationId) {
    await fetch(
      `${url}/rest/v1/reservations?id=eq.${encodeURIComponent(reservationId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "confirmed" }),
      }
    );
  }

  return res.status(200).json({
    ok: true,
    paymentId,
    orderId,
    reservationId: reservationId || null,
  });
}
