#!/usr/bin/env python3
"""
Banjara menu extractor.

Reads menu.html, walks each <div class="menu-section-block"> in document order,
captures the heading text as a category, and collects all <div class="menu-row">
children inside as items (name, optional description, price).

Emits two artifacts:
  - supabase/seed/menu_seed.sql   (idempotent: truncate + insert)
  - supabase/seed/menu_seed.json  (human-readable for review/debugging)

Veg/non-veg is inferred by keyword scan over name + desc. If we miss one,
the owner can flip the toggle in admin — no data is destroyed.
"""

import json
import re
from pathlib import Path
from bs4 import BeautifulSoup

# --- non-veg signal words. Conservative — false positives matter less than
# misses, since the admin can correct either way.
NON_VEG_HINTS = [
    r"\bchicken\b", r"\blamb\b", r"\bmutton\b", r"\bfish\b", r"\bprawns?\b",
    r"\bshrimps?\b", r"\bcrab\b", r"\bbeef\b", r"\bpork\b", r"\bbacon\b",
    r"\bham\b", r"\bsalmon\b", r"\btuna\b", r"\beggs?\b", r"\banchov(?:y|ies)\b",
    r"\bduck\b", r"\bturkey\b", r"\bkeema\b",
    # "Seekh kebab" alone is a strong meat signal in the right context — but on
    # this menu the seekhs are explicitly labelled (Lamb mince / Soya). So we
    # rely on the explicit hint above (lamb), and leave generic "seekh" out
    # to avoid catching vegetarian seekhs like "Hariyali Soya Seekh".
]
_NV_RE = re.compile("|".join(NON_VEG_HINTS), re.IGNORECASE)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "menu.html"
OUT_SQL = ROOT / "supabase" / "seed" / "menu_seed.sql"
OUT_JSON = ROOT / "supabase" / "seed" / "menu_seed.json"


def slugify(text: str) -> str:
    s = text.lower()
    s = re.sub(r"&[a-z]+;", " ", s)        # html entities like &amp;
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def clean_heading(node) -> str:
    """A heading may be 'Dimsums & Baos <span>...subtitle...</span>'.
    Keep only the leading category text, drop the italic subtitle span."""
    # Drop trailing <span> notes
    for span in node.find_all("span"):
        span.decompose()
    txt = node.get_text(" ", strip=True)
    # Collapse multiple spaces; normalise nbsp
    return re.sub(r"\s+", " ", txt).strip()


def parse_price(price_txt: str):
    """Return (price, range_note). Handles plain '₹375' and ranges like '₹285–295'.
    For a range, returns (lower, 'Range ₹285–295') so the owner sees it in the desc.
    """
    # Normalise different dash chars
    norm = price_txt.replace("–", "-").replace("—", "-")
    nums = re.findall(r"\d[\d,]*", norm)
    if not nums:
        return 0.0, None
    if len(nums) >= 2:
        lo = float(nums[0].replace(",", ""))
        hi = float(nums[1].replace(",", ""))
        return lo, f"Range ₹{int(lo)}–{int(hi)}"
    return float(nums[0].replace(",", "")), None


def looks_non_veg(name: str, desc: str) -> bool:
    blob = f"{name} {desc or ''}"
    return bool(_NV_RE.search(blob))


def sql_str(s: str) -> str:
    if s is None:
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def main():
    html = SRC.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")

    categories = []  # list of {name, slug, sort_order, items: [...]}
    seen_slugs = {}

    for block in soup.select("div.menu-section-block"):
        heading_el = block.select_one(".menu-section-heading")
        if not heading_el:
            continue
        # Heading is wrapped in a fresh copy so we don't mutate the live tree
        # (clean_heading destructively drops <span> notes).
        from copy import copy
        heading_copy = BeautifulSoup(str(heading_el), "html.parser").select_one(".menu-section-heading")
        cat_name = clean_heading(heading_copy)
        if not cat_name:
            continue

        slug = slugify(cat_name)
        # In case two headings collide (e.g. duplicated section), suffix.
        if slug in seen_slugs:
            seen_slugs[slug] += 1
            slug = f"{slug}-{seen_slugs[slug]}"
        else:
            seen_slugs[slug] = 1

        items = []
        for row in block.select(".menu-row"):
            name_el = row.select_one(".row-name")
            desc_el = row.select_one(".row-desc")
            price_el = row.select_one(".row-price")
            if not name_el or not price_el:
                continue
            # Strip embedded <span> notes inside name (e.g. "(8 pcs)") but keep them in desc
            from copy import copy as _copy
            name_clean_el = BeautifulSoup(str(name_el), "html.parser").select_one(".row-name")
            qty_note = ""
            for span in name_clean_el.find_all("span"):
                qty_note = span.get_text(" ", strip=True)
                span.decompose()
            name = re.sub(r"\s+", " ", name_clean_el.get_text(" ", strip=True))
            desc_text = desc_el.get_text(" ", strip=True) if desc_el else ""
            if qty_note and qty_note.lower() not in desc_text.lower():
                desc_text = (desc_text + " " + qty_note).strip()
            price, range_note = parse_price(price_el.get_text(" ", strip=True))
            if range_note:
                desc_text = (desc_text + " · " + range_note).strip(" ·")
            is_veg = not looks_non_veg(name, desc_text)
            items.append({
                "name": name,
                "description": desc_text or None,
                "price": price,
                "is_veg": is_veg,
            })

        if items:  # don't seed empty categories
            categories.append({
                "name": cat_name,
                "slug": slug,
                "sort_order": len(categories),
                "items": items,
            })

    # ---- write JSON for review ----
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(categories, indent=2, ensure_ascii=False), encoding="utf-8")

    # ---- write SQL ----
    lines = [
        "-- =========================================================================",
        "-- Banjara menu seed — generated by scripts/extract_menu.py",
        "-- Idempotent: wipes menu tables then reseeds.",
        "-- =========================================================================",
        "",
        "begin;",
        "",
        "truncate table menu_items, menu_categories restart identity cascade;",
        "",
    ]

    total_items = 0
    for cat in categories:
        lines.append(
            f"with c as (insert into menu_categories (name, slug, sort_order) values "
            f"({sql_str(cat['name'])}, {sql_str(cat['slug'])}, {cat['sort_order']}) returning id)"
        )
        # Now insert items selecting category_id from `c`
        value_rows = []
        for i, it in enumerate(cat["items"]):
            value_rows.append(
                "((select id from c), "
                f"{sql_str(it['name'])}, "
                f"{sql_str(it['description'])}, "
                f"{it['price']:.2f}, "
                f"{'true' if it['is_veg'] else 'false'}, "
                f"{i})"
            )
            total_items += 1
        lines.append(
            "insert into menu_items (category_id, name, description, price, is_veg, sort_order) values"
        )
        lines.append(",\n".join(value_rows) + ";")
        lines.append("")

    lines.append("commit;")
    OUT_SQL.parent.mkdir(parents=True, exist_ok=True)
    OUT_SQL.write_text("\n".join(lines), encoding="utf-8")

    # ---- report ----
    print(f"Categories: {len(categories)}")
    print(f"Items:      {total_items}")
    nonveg = sum(1 for c in categories for i in c["items"] if not i["is_veg"])
    print(f"Non-veg detected: {nonveg}")
    print(f"\nWrote {OUT_SQL.relative_to(ROOT)}")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print("\nCategory roster:")
    for c in categories:
        print(f"  - {c['name']:<35} ({len(c['items'])} items)")


if __name__ == "__main__":
    main()
