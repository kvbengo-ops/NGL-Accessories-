# NGL Accessories — QA Audit & Outstanding Work

## Overall Completion: 18/18 code items complete

All code-level blockers and UX gaps from the audit are resolved. The only items left
are external/business setup steps that require accounts and credentials the codebase
can't provide (detailed below).

### ✅ Completed Items

1. **Order confirmation page (RLS)** — Fixed. A `SECURITY DEFINER` RPC `get_order_public(id)` handles read-access safely without opening broad table permissions.
2. **Stored XSS in the admin panel** — Fixed. `escapeHtml` is actively utilized to sanitize customer name, address, and order notes in `orders.js` and `dashboard.js`.
3. **Homepage cart icon is dead** — Fixed. `main.js` now contains working cart logic that tracks state consistently with `shop.html`.
4. **Newsletter signup is fake** — Fixed. It correctly submits emails to `newsletter_subscribers` in Supabase.
5. **"Change Password" button in Admins** — Fixed. Linked to the `update_admin_password` RPC.
6. **Pending orders hold stock forever** — Fixed. `pg_cron` is configured in the schema to auto-cancel stale orders.
7. **Customers can order out-of-stock items** — Fixed. Stock validations are present; out-of-stock items disable the "Add to Cart" UI in `shop.js`.
8. **No customer order lookup/tracking** — Fixed. `track-order.html` and logic have been implemented.
9. **Order fulfillment is status-only** — Fixed. Confirmation prompts before status changes, plus **courier + tracking number** fields: admins set them in the order detail modal, customers see them on `track-order.html`, and they're included in the CSV export.
10. **POS doesn't record payment reference** — Fixed. The reference input is successfully captured in `pos.js`.
11. **Storefront trusts client-sent prices** — Fixed. `create_order_safely` computes pricing authoritatively on the server.
12. **Dead footer links** — Fixed. Essential pages (`privacy.html`, `terms.html`, `support.html`, `404.html`) have been populated.
13. **No product search on the shop** — Fixed. Search logic implemented in `shop.html`.
14. **Fullscreen swipe is buggy** — Fixed. A `destroy()` method was implemented for `SwipeStack`.
15. **Missing 404 Page** — Fixed. Added `404.html`.
16. **Hardcoded store configs** — Fixed. New `store_settings` table (public read, superadmin write) drives the shipping fee, free-shipping threshold, GCash details, and bank accounts. Editable at **Admin → Store Settings** (`admin/settings.html`). Both the checkout UI *and* `create_order_safely` read from it, so the server-charged total always follows the configured rule.
17. **README was UTF-16 encoded** — Fixed. Re-saved as UTF-8 so it renders correctly on GitHub.
18. **Transactional emails** — Code complete. The Resend Edge Function + DB trigger (`setup/order-emails.sql`) are written and documented in the README; see deployment checklist below.

---

### 🟡 Launch Checklist (external setup — not code)

These can't be completed from the codebase; they need business accounts/credentials:

1. **Resend order emails** — ✅ DONE (deployed and confirmed working).
2. **Newsletter welcome emails** — code complete (`supabase/functions/newsletter-welcome` + `setup/newsletter-emails.sql`). To activate: `supabase functions deploy newsletter-welcome --no-verify-jwt`, then run `setup/newsletter-emails.sql` with the same `WEBHOOK_SECRET`. Reuses the already-working Resend secrets; includes a self-serve unsubscribe link. (README §6.)
3. **Real payment gateway (optional)** — checkout currently takes GCash/bank-transfer reference numbers that an admin verifies manually, which is a workable launch model for a small shop. Automating capture requires a PayMongo merchant account; once keys exist, integrate in `src/checkout.js` (`placeOrder`).
4. **Replace placeholder payment details** — after running `schema.sql`, set the real GCash number/name and bank accounts in **Admin → Store Settings** (defaults are placeholders).
