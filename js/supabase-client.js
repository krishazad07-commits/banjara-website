// ============================================================================
// Supabase client — singleton, ESM from JSDelivr (no bundler).
// Imported by any page that talks to the database.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persist session across reloads (admin login). For public pages this is a no-op.
    persistSession: true,
    storageKey: "banjara-auth",
    autoRefreshToken: true,
  },
});
