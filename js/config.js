// ============================================================================
// Banjara — public client config
// ----------------------------------------------------------------------------
// The Supabase URL and publishable key are SAFE to ship in client code. They're
// designed for the browser. Real protection comes from row-level security
// policies in supabase/migrations/0002_rls_policies.sql.
//
// Service role key (and Razorpay secret, when added) NEVER live here — they're
// loaded from environment variables inside serverless functions (/api/*).
// ============================================================================

export const SUPABASE_URL = "https://klrjilcpjxzvcbztpnfp.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_DNASJs7OiXD6SQOySF9NCQ_hOd_187y";

// Payment mode: "mock" until Razorpay credentials are provisioned by the client.
// Swapping to "razorpay" requires only:
//   1. RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in Vercel env
//   2. flipping this flag
// The order create/verify functions in /api are written to accept either path.
export const PAYMENT_MODE = "mock";

// Restaurant operational constants. Kept here, not in DB, because they govern
// UI logic (slot picker, validation) that needs them synchronously.
export const RESTAURANT = {
  name: "Banjara Fine Dining",
  city: "Ahmedabad",
  ownerEmail: "owner@banjara.local", // placeholder — updated at handover
  // Pickup window: how far ahead the customer can schedule a pickup, in minutes.
  pickupLeadMinutes: 30,
  pickupHorizonHours: 48,
  // Table pre-order prepayment: this is the *deposit* required to lock a table.
  // Expressed as a fraction of the order total. 1.0 = full prepay (the PDF's
  // "table pre-orders secured by UPI prepayment").
  tablePrepayRatio: 1.0,
};
