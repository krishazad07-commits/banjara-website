// ============================================================================
// Menu data layer
// ----------------------------------------------------------------------------
// Fetches categories + items from Supabase once, then caches in sessionStorage
// for the session. The admin's "save" flow busts this cache via clearMenuCache().
// ============================================================================

import { supabase } from "./supabase-client.js";

const CACHE_KEY = "banjara-menu-cache-v1";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — stale data on the public menu is fine

export function clearMenuCache() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
}

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch (_) { return null; }
}

function writeCache(data) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data })); } catch (_) {}
}

/**
 * Returns: [{ id, name, slug, sort_order, items: [{ id, name, description, price, is_veg, is_special }] }]
 * Items are pre-filtered to is_available = true (also enforced by RLS).
 */
export async function fetchMenu({ force = false } = {}) {
  if (!force) {
    const cached = readCache();
    if (cached) return cached;
  }

  // One round-trip via FK join. PostgREST flattens the relation.
  const { data, error } = await supabase
    .from("menu_categories")
    .select(`
      id, name, slug, sort_order,
      items:menu_items(
        id, name, description, price, is_veg, is_special, sort_order, image_url
      )
    `)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  // PostgREST doesn't guarantee child sort order from the embedded select on every
  // version, so we re-sort client-side for safety.
  const shaped = (data || []).map((cat) => ({
    ...cat,
    items: (cat.items || [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order),
  }));

  writeCache(shaped);
  return shaped;
}
