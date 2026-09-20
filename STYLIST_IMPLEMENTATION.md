# NGL Stylist — Groq RAG implementation

Updated 20 September 2026. This supersedes the earlier template-based implementation notes.

## Actual request flow

1. Browser sends the latest message, bounded session conversation history, prior product IDs and current style brief to POST /api/stylist.
2. Groq interprets the conversation and expands it into a retrieval query. Occasion, theme and outfit are independent fields: black dress + prom + 80s remain visible and available to later turns.
3. The server reads the current public product catalog from Supabase with explicit pagination. No product cost, orders, customer lists or admin data enter retrieval.
4. Deterministic constraints exclude inactive/out-of-stock products and enforce category, exclusions, metal-color requirements and budget. Query-expanded lexical retrieval ranks actual names, tags and descriptions with inverse-document-frequency weighting. Up to 12 leading candidates, plus set-category coverage, become the context.
5. Groq reads those retrieved product records AND the conversation and generates the styling response, chooses product IDs, explains the choices, and cites exact supporting product text.
6. Code verifies the product IDs belong to the retrieved context, validates evidence excerpts and set totals, and renders prices/images from database values. Expand “From the product details” on a card to inspect its cited source.

This is retrieval-augmented generation using lexical retrieval and Groq query expansion; it does not use embedding/vector search. There are no static occasion-to-collection recommendation rules or templated successful styling replies. General styling judgment is generated; physical product claims must be grounded. Citation checks reduce fabrication risk but cannot prove every generated assertion.

## Provider and availability

Stylist uses GROQ_API_KEY and GROQ_MODEL (default openai/gpt-oss-120b). It never calls Gemini. Existing customer-support provider configuration is separate and unchanged.

The Worker requires STYLIST_AI_ENABLED=true and its STYLIST_LIMITER binding. Vite development uses the real Groq path by default; STYLIST_LOCAL_AI=false explicitly disables it. Provider failures are reported honestly with Browse the collection available. They do not fall back to static product advice. Provider rate limits expose a retry delay; no cross-provider failover or unlimited retry is performed. A malformed or unverifiable generated draft gets one regeneration using the same evidence and original deadline. Network, quota, and timeout failures are not retried automatically.

Cloudflare's binding limits 10 requests/minute/IP approximately per location, not globally. Groq has separate request/token limits shared with other uses of the same account. Each successful conversation turn makes two Groq calls. Compact retrieved snippets bound token usage, but account limits may still require waiting or a different provider plan. API work has a 25-second deadline; the frontend allows 30 seconds.

## Interface and cart

Open /shop.html?stylist=1 or use Ask a stylist / Help me choose. The editorial desktop dialog becomes a full-screen mobile sheet. Native dialog focus/Escape handling, keyboard sizing, reduced motion, labeled controls, status messages, and product-evidence disclosures are included.

Conversation history is memory-only (last eight messages, bounded again server-side). Start over/reload clears it. Messages are not stored in support tables. Common email/phone patterns are redacted before Groq requests; provider retention settings still apply. No raw prompt/body logging is added.

Add to bag is an explicit shopper action. Current price/stock is rechecked first, and a changed price requires another click after review. Shop and stylist use the same cart-store.js storage format. Checkout remains authoritative.

Customer care remains on support, checkout, tracking and confirmation pages. /support.html?chat=1 opens the existing support chat when enabled. Existing support history/admin queue is preserved.

## Coverage and limitations

Catalog retrieval pages in batches of 250, up to 5,000 active rows; an oversized or failed retrieval errors instead of claiming a complete catalog. Query expansion helps match themes to catalog attributes, but sparse product descriptions limit results. There is no image analysis, virtual try-on, verified material enrichment, persistent customer profile or autonomous purchase.

Shoppers asking for allergy/waterproof/material suitability are directed to confirmation of specifications; the model cannot assume these properties. Budgets and availability are enforced by code, with source prices/stock still subject to change after retrieval.

## Verification

Run node --test test-stylist.mjs and npm run build. Tests cover the reported black-dress to 80s-prom regression, history and theme retrieval, source citations, invalid IDs, budget and set constraints, product pagination, Groq-only behavior, explicit provider failures, rate limiting, and shared cart quantities.

Live endpoint checks passed on the connected local preview: “i want something school friendly” returned mode=rag with Cabochon Pearl and Flatline; “how about for prom. the prom theme is 80s” retained black dress/Prom/80s and returned Vetra, Pebble Grid and Bamboo Drop with new generated advice. These are observed test results, not fixed recommendations or promises of future stock.

The initial port-5174 development process lacked outbound network permission and was restarted with network access. That preview now reaches Supabase and Groq. Network-denied previews, provider quota and timeouts have distinct error messages. Visual browser QA remains pending because this session exposes no browser/native app surfaces. No deployment was performed by this implementation.

Technical references: https://console.groq.com/docs/structured-outputs and https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
