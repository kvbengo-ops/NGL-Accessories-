# AI Stylist — Implementation Plan (Hybrid)

Add an "AI Stylist" to the shop page: the user describes their outfit, and we
recommend a personalized 3-piece jewelry combo — at **$0 cost, with no API key
exposed in the browser**.

**Approach:** a local rules engine does the *selection* (grounded in real
products, instant, free, no key); the "AI creativity" comes from build-time
catalog enrichment + attribute-aware copy; an optional Cloudflare Workers AI
layer can later upgrade just the *copy*, with automatic fallback. Same sleek UI
as originally proposed.

This plan is written against the actual codebase: `PRODUCTS`, `addToCart`,
`buildProductCard`, the `.view-toggle`, collections `natural/grace/lush`, and
categories `Earrings/Rings/Bracelets/Necklaces/Anklets`.

---

## Architecture at a glance

```
User input ──▶ Intent Parser ──▶ Scorer ──▶ Combo Composer ──▶ Copy Generator ──▶ Result card
"black gala dress"   {occasion,        rank all      pick 3 with        attribute-aware     3 products +
                      formality,       in-stock      styling rules       template (or         stylist note +
                      tone, vibe}      products                          Cloudflare AI)       "Add Combo"
```

Everything except optional Phase 3 runs in the browser. Selection is **always
grounded** in `PRODUCTS`, so it can never recommend something not in stock.

---

## Phase 0 — Data check & enrichment (do this first)

Quality rides entirely on product data, so we start here.

- **Audit** current `tags` / `description` richness across the live products.
- **Enrich (optional but recommended):** a one-time, offline script
  (`setup/enrich-stylist.mjs`) that asks an LLM *once* (run locally with your own
  key, then discarded — never shipped) to add structured style metadata per
  product:

  ```jsonc
  // stored as products.style_meta (jsonb), OR a static map keyed by product id
  {
    "occasions": ["formal", "evening", "gala"],
    "formality": 5,
    "tone": "warm-gold",
    "vibe": ["elegant", "statement"],
    "pairs_well": ["Necklaces", "Earrings"]
  }
  ```

- **Graceful fallback:** the runtime engine derives the same signals from
  existing `collection` + `itemCategory` + `tags` + `desc` when `style_meta` is
  missing — so the feature works **today with zero enrichment**, and just gets
  sharper once enriched. New products never break it.

**Deliver:** a clear picture of data quality + (optionally) richer metadata.
**Decision gate:** static JSON map (fast, no DB change) vs. `style_meta` jsonb
column (future-proof, editable in admin).

## Phase 1 — The engine (pure JS, no UI, testable)

New files, logic only — isolated and reviewable:

- `src/stylist-data.js` — lexicons + templates (no logic): occasion synonyms
  (`gala/wedding/party → formal-evening`, `beach/resort/vacation → lush`,
  `office/work → everyday`…), color & metal words, vibe words, copy templates,
  and curated "Looks."
- `src/stylist-engine.js` — four pure functions:

  ```js
  parseIntent(text)        // → { occasions:Set, formality:1–5, tone, vibe:Set, colors:Set }
  scoreProduct(p, intent)  // weighted match over collection/category/tags/desc/style_meta → number
  composeLook(products, intent)
    // 1. rank by score
    // 2. pick a 3-piece set with STYLING RULES:
    //    – category diversity (e.g. Earrings + Necklace + Bracelet, not 3 rings)
    //    – one statement piece + two supporting
    //    – coherent formality & collection (a gala look skews 'grace')
    //    – keep within a sane price spread
  generateCopy(look, intent)  // attribute-aware template → personalized note
  ```

These take plain data and return plain data → trivially unit-testable, and
reusable by the optional Cloudflare function later.

## Phase 2 — UI integration into the shop (the MVP ships here)

Mirrors how `Discover` / `Browse All` already work:

- **`shop.html`:** add a 3rd `view-btn` to the existing `.view-toggle` →
  `[ Discover ] [ Browse All ] [ ✨ Stylist ]`; add a hidden `#stylist-view`
  section (input, curated-look chips, skeleton, result container).
- **`src/shop.js`:** add `showStylistView()` next to `showSwipeView()` /
  `showGridView()` (toggle active states + `aria-pressed`, hide the other
  views). Wire the new button. Import the engine.
- **Reuse what exists:** render the 3 picks with `buildProductCard()` (or a
  compact variant); **"Add Combo to Cart"** loops `addToCart()` over the 3
  (already handles stock + cart badge animation); skeleton reuses the existing
  shimmer pattern.
- **`src/style.css`:** styles for the stylist view — glowing input,
  curated-look chips, "Stylist's Pick" card — using brand tokens (serif, gold,
  ivory) so it matches the editorial look.

**UX flow:** type outfit → ~250ms skeleton → "Stylist's Pick" card reveals 3
products + a personalized note + Add Combo. One-tap **curated Looks** (Wedding
Guest · Beach Day · Office · Date Night · Gala) sit above the input so it feels
alive before anyone types.

## Phase 3 — Optional, later: live AI copy on Cloudflare

Only if you want generative flair beyond templates:

- `functions/api/stylist.js` — a **Cloudflare Pages Function** (your existing
  host) using the Workers AI binding to write the stylist note. **Selection
  stays local; the LLM only writes prose and never picks products.**
- Catalog is small → fits in one prompt. **Cache** responses by normalized
  prompt so repeat queries ("black dress", "wedding") are instant and you stay
  deep inside the free Neuron allowance.
- **Fallback:** if the call fails / is over quota, silently use the Phase-1
  template. Behind a `STYLIST_LIVE_AI` flag, off by default.

---

## Cost & safety

- **$0 runtime, no API key in the browser, no quota risk** (Phases 0–2).
  Phase 3 stays on Cloudflare's free tier with caching + key server-side.
- **Grounded:** picks come from in-stock `PRODUCTS` only → no hallucinated items.
- **Additive & reversible:** all new files + 3 small hooks in
  `shop.html` / `shop.js`; removing the view-button disables it cleanly.

## Accessibility & performance

- Respect `prefers-reduced-motion` (skeleton/reveal), `:focus-visible` on
  input/chips/buttons, `aria-live` on the result, 44px touch targets, and
  `role` / `aria-pressed` on the toggle — consistent with the filter redesign.
- Zero added page weight in the MVP (no model download, no extra fonts); the
  engine is a few KB.

## Verification

- Unit-test the engine with sample prompts ("black velvet gala dress", "casual
  beach brunch", "minimalist office") → assert sensible, category-diverse
  3-piece sets.
- Run it live via the dev server (headless Chrome screenshots) for both the
  input and result states; confirm Add Combo updates the cart badge.

---

## Recommended scope to start

**Phase 0 → 1 → 2** = the full hybrid, all $0, nothing for you to set up, ships
a real feature. Treat **Phase 3 as a later toggle.**

**Next step:** Phase 0 — dump the current `tags` / `description` data to see what
we're working with, which also decides the static-JSON-vs-`style_meta` question.

---

## Runtime reference (for implementation)

Runtime product shape (from `initShop()` mapping in `src/shop.js`):

```js
{
  id, name,
  collection,       // lowercased: 'natural' | 'grace' | 'lush'
  collectionLabel,  // original case
  itemCategory,     // 'Earrings' | 'Rings' | 'Bracelets' | 'Necklaces' | 'Anklets'
  category,         // == collection (lowercased)
  categoryLabel,
  price,            // Number (PHP, ₱)
  desc,             // string (from products.description)
  tags,             // string[]
  emoji, image, stock
}
```

Reusable helpers already in `src/shop.js`: `addToCart(product)`,
`buildProductCard(product)`, `loadCart()`, `saveCart()`, `showToast()`,
`showSwipeView()` / `showGridView()` (pattern for `showStylistView()`).
