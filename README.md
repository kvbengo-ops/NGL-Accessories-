# NGL Accessories

E-commerce storefront + admin back-office for **NGL Accessories**, a Philippines-based
premium jewelry brand. Built with **Vanilla HTML/CSS/JS** and **Vite**, backed by
**Supabase** (Postgres + Auth + Storage + Edge Functions).

## Features

- **Storefront** — editorial landing page, swipe/grid shop, cart, multi-step checkout,
  order confirmation, and customer order tracking (with courier + tracking number once shipped).
- **Admin portal** (`/admin`) — dashboard (KPIs, P&L, sales chart), orders (incl. fulfilment
  courier/tracking), POS terminal, inventory, expenses ledger, tasks/kanban + to-do,
  admin-user management, and store settings (shipping rules + payment account details).

## Tech stack

| Layer    | Choice                                              |
|----------|-----------------------------------------------------|
| Frontend | Vanilla HTML/CSS/JS, Vite (multi-page build)        |
| Backend  | Supabase — Postgres, Auth, Storage, Edge Functions  |
| Email    | Resend (via a Supabase Edge Function)               |

## Prerequisites

- Node.js (see `.nvmrc`)
- A Supabase project

## 1. Install & configure

```bash
npm install
```

Create a `.env` in the project root (it is git-ignored — never commit it):

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-OR-PUBLISHABLE-KEY
```

Only the **anon/publishable** key belongs here — it is safe to ship to the browser.
Never put the service-role key in this file.

## 2. Set up the database

In the Supabase dashboard → **SQL Editor**, run the full script:

- `setup/schema.sql` — tables, RLS policies, seed data, and all RPCs/triggers
  (safe order creation, stock restore on cancel, engagement, order tracking,
  store settings, etc.).

Optional but recommended:

- Enable the **`pg_cron`** extension (Database → Extensions), then re-run `schema.sql`
  so stale `pending` online orders are auto-cancelled hourly (which restocks them).

## 3. Create the first admin

Auth is handled by Supabase. The **first** user created automatically becomes the
`superadmin` (see the `handle_new_user` trigger in `schema.sql`). Create them via
the Supabase dashboard (Authentication → Users → Add user) or the admin login page,
then sign in at `/admin/login.html`. Superadmins can add more admins from
**Admin Users**.

## 4. Configure the store

Sign in as the superadmin and open **Admin → Store Settings** to set:

- Shipping fee and free-shipping threshold (also enforced server-side in
  `create_order_safely` — the checkout can't be tampered into a different total).
- The GCash number/name and bank accounts shown to customers at checkout.

Defaults are seeded by `schema.sql`, so checkout works out of the box.

## 5. (Optional) Order notification emails

Confirmation + admin-alert emails are sent server-side when an online order is inserted.

1. Create a [Resend](https://resend.com) account and verify your sending domain.
2. Deploy the function:
   ```bash
   supabase functions deploy order-notification --no-verify-jwt
   ```
3. Set the function secrets (`RESEND_API_KEY`, `FROM_EMAIL`, `ADMIN_EMAIL`, `STORE_URL`,
   `WEBHOOK_SECRET`) — see the header of `supabase/functions/order-notification/index.ts`.
4. In the SQL Editor, run `setup/order-emails.sql`, replacing `<WEBHOOK_SECRET>` with the
   same value you set for the function.

Until this is done, orders still work — customers just won't receive an email receipt.

## 6. (Optional) Newsletter welcome emails

"Inner Circle" signups are stored in `newsletter_subscribers` either way; this step
sends each new subscriber a branded welcome email (with a working unsubscribe link).
It reuses the same Resend secrets as step 5 — nothing new to configure.

1. Deploy the function:
   ```bash
   supabase functions deploy newsletter-welcome --no-verify-jwt
   ```
2. In the SQL Editor, run `setup/newsletter-emails.sql`, replacing `<WEBHOOK_SECRET>`
   with the same value used in step 5.

The unsubscribe link in the email points back at the function itself (GET request
deletes the subscriber), so no extra site page is needed.

## Local development

```bash
npm run dev       # start the Vite dev server (http://localhost:5173)
npm run build     # production build to dist/
npm run preview   # preview the production build
```

All pages are registered in `vite.config.js` under `build.rollupOptions.input`.
If you add a new top-level `.html` page, add it there too or it won't be built.

## Deployment

Deploy the contents of `dist/` to any static host (Netlify, Cloudflare Pages, Vercel,
etc.). Set the two `VITE_` environment variables in the host's build settings. Most
hosts will serve `404.html` automatically for unknown routes.

## Project structure

```
index.html, shop.html, checkout.html, order-confirm.html,
track-order.html, support.html, privacy.html, terms.html, 404.html
admin/        # admin portal pages (incl. settings.html)
src/          # JS per page + shared supabase.js / admin.js + style.css
setup/        # schema.sql, order-emails.sql, newsletter-emails.sql
supabase/     # Edge Functions
public/       # static images
```

## Going further

The storefront includes **NGL Stylist**, a Groq-powered conversational jewelry guide grounded in retrieved live catalog data, with product cards and add-to-bag controls. Open `/shop.html?stylist=1` to try it. See [stylist implementation notes](STYLIST_IMPLEMENTATION.md) for retrieval, provider settings, error handling, and verification. Run its checks with `node --test test-stylist.mjs`.

The one remaining gap, left intentionally for a small shop:

- **Payments are manual** — customers submit a GCash/bank reference that an admin
  verifies before fulfilment. Automating this requires a PayMongo (or similar)
  merchant account; once you have API keys, wire it up in `src/checkout.js`
  (`placeOrder`).
