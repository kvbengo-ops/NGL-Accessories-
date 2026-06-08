# NGL Accessories — QA Audit & Outstanding Work

## 🔴 Blockers — Broken flows that fail for real users

1. **Order confirmation page fails for actual customers (RLS)**
   - `order-confirm.js` reads the order as an anonymous visitor: `supabase.from('orders').select('*, order_items(*)').eq('id', id).single()`
   - **Issue:** In `schema.sql`, the only anon policy on `orders`/`order_items` is `FOR INSERT`. There is no anon `SELECT` policy (`orders_admin_all` is authenticated only). A logged-out customer gets zero rows → "Could not load order." This only works during testing because you are logged into the admin panel in the same browser. 
   - **Fix:** Add a narrow read path — a `SECURITY DEFINER` RPC `get_order_public(id)` that returns one order, rather than opening a broad anon `SELECT`.

2. **Stored XSS in the admin panel via customer order fields**
   - `orders.js` (`renderTable` + `showOrderDetail`) and `dashboard.js` inject `customer_name`, `delivery_address`, and `order_notes` straight into `innerHTML` with no escaping.
   - **Issue:** These fields are attacker-controlled at checkout. A customer ordering with a name like `<img src=x onerror=...>` runs a script in the admin's authenticated session.
   - **Fix:** `todo.js` already has an `escapeHtml` helper. Reuse it everywhere order/customer data is rendered.

3. **Homepage cart icon is dead**
   - `index.html` navbar has a `.cart-btn` and `.cart-count` badge, but `main.js` has no cart code at all. 
   - **Issue:** The badge is permanently "0" and clicking the icon does nothing. The cart only works on `shop.html`. A user who adds items, returns to the homepage, sees an empty cart and no way to check out.

4. **Newsletter signup is fake**
   - `main.js` shows a success message but never persists the email anywhere (no Supabase insert, no API).
   - **Issue:** Every "Join the Inner Circle" submission is silently discarded.

5. **"Change Password" button in Admins is non-functional**
   - `admins.js` → `handleEditPassword` just toasts "change passwords in the Supabase Dashboard" and closes. 
   - **Issue:** Ironically, the working RPC `update_admin_password` already exists in `schema.sql` but is never called.
   - **Fix:** Either wire it up or remove the button.

---

## 🟠 Major Missing Flows (Ordering / Fulfillment)

- **No real payment gateway:** Checkout takes a free-text "reference number" with zero verification. No PayMongo/GCash/card gateway integration. Any string is accepted.
- **Pending orders hold stock forever:** `create_order_safely` reduces inventory at order time. A customer who abandons at the payment step (or a fake order) holds that stock forever. There is no auto-expire/restock job for stale pending orders, creating a real oversell risk.
- **Customers can order out-of-stock items:** The storefront never checks `inventory.stock`. Sold-out products are addable to the cart and only fail at the very end with a raw Postgres error in an `alert()`. Show stock state and disable "Add" when 0.
- **No customer order lookup/tracking:** The confirm URL is the only receipt (and per #1, it may not even load). There is no "track my order" page, and no status updates are emailed to the customer (e.g., "shipped").
- **Order fulfillment is status-only:** Admins can flip a dropdown (`pending` → `shipped` → `delivered`) but there's no tracking number, courier, ship date, or partial fulfillment tracking. Status changes also have no confirmation warnings — one mis-click cancels an order (and restocks).
- **Transactional emails not live:** The Resend edge function + webhook are coded but require manual deployment and domain verification. Currently, customers get no receipt email, and admins get no alert unless the dashboard tab is open.

---

## 🟡 Admin-Side Gaps

- **POS doesn't record the payment reference:** Non-cash POS sales show a reference field, but `completeSale` saves only `payment_method: payMethod`. The typed GCash/bank ref is dropped.
- **No store settings page:** Shipping fee (₱150) and free-shipping threshold (₱1500) are hardcoded in `checkout.js`. Tax, store info, and payment account numbers are all hardcoded. Admins have no control over this.
- **No stock movement history/audit log:** Stock is overwritten directly with no record of who changed what or why (sale vs. manual adjustment vs. restock).
- **No discount/voucher system online:** The storefront has no promo code support (though the POS has a manual discount field).
- **Admin signup flow is fragile:** Creating an admin uses client-side `supabase.auth.signUp`, then restores the superadmin session. If email confirmation is enabled in Supabase, the new admin can't log in until they confirm; the session-swap is also racy. A server-side admin-invite function would be more robust.
- **Reports are thin:** The Dashboard has 7-day revenue + P&L, but no date-range reports, no per-collection/category breakdown, and no CSV export for sales/expenses (`orders` has CSV; `expenses` doesn't).

---

## 🔵 Storefront / UX

- **Dead footer links:** Shipping & Returns, Contact, FAQ, Privacy Policy, Terms, Cookie Policy, Store Locator, and the Instagram/TikTok/Facebook icons all go nowhere (`href="#"`). Missing Privacy/Terms is a compliance gap for a store collecting customer data.
- **No product search on the shop:** Only collection filter pills exist.
- **No 404 page.**
- **Fullscreen swipe is buggy (`shop.js`):** It calls `fsSwipeStack.destroy()`, but `SwipeStack` has no `destroy()` method, throwing an error on the second open. Furthermore, `SwipeStack` attaches document-level listeners that are never removed, causing conflicting drag behaviors.
- **Lingering UI/UX audit items:** Focus rings, prefers-reduced-motion, low-contrast footer text, and sub-44px touch targets are still open on the homepage.

---

## 🔒 Security / Config

- **.env is committed to git:** Tracked despite being in `.gitignore`. It only holds the public anon URL + publishable key (safe to expose), but `git rm --cached .env` should be run to stop tracking it and avoid a future accident with a real secret.
- **Storefront trusts client-sent prices:** `create_order_safely` correctly recomputes cost/profit server-side, but trusts the client's price for `subtotal`/`total`. A tampered request could under/over-charge. Consider sourcing price from the `products` table inside the RPC too.
- **RLS scoped broad for admins:** `admins` and `orders` correctly gates writes to authenticated users, but there is no row-level scoping beyond that (any admin can edit any order/admin). Fine for a small team, but worth noting.

---

## 🧹 Dead Code / Cleanup

- **Leftover files:** `next.config.ts`, `components/ui/*.tsx`, and `components/hero-scroll-demo.tsx` are Next/React/shadcn leftovers in a vanilla-Vite project. Unused.
- **Unused functions:** `decrementStock()` in `supabase.js` is unused (the RPC handles stock).
- **Design files in repo:** `ui ux/` design-reference folder ships in the repo.
- **Empty README:** `README.md` is effectively empty (42 bytes). No setup/deploy docs despite a non-trivial Supabase setup.
- **Conflicting build configs:** Both `netlify.toml` and Cloudflare build configs exist. Confirm which host is canonical.

---

## 📋 Suggested Priority Order for Fixing

1. **Fix the order-confirm RLS read (#1)** — Verify in incognito first. Without it, every online order ends on a broken screen.
2. **Escape order/customer fields in admin (#2)** — Fix the stored XSS vulnerability in your admin session.
3. **Wire the homepage cart & newsletter (#3, #4)** — Ensure the storefront functionality works completely.
4. **Guard stock & oversells (#🟠)** — Block out-of-stock add-to-cart, and add an auto-expire job for stale pending orders.
5. **Add confirm-dialogs to order status changes & capture POS payment ref.**
6. **Decide on payments** — Choose between a real gateway or keeping manual checks, and activate the order emails.
7. **Cleanup & Legal Pages** — Add footer legal pages, product search, and perform dead code cleanup.
