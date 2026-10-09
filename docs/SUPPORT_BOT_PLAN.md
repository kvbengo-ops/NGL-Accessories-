# AI Customer-Support Chatbot — Implementation Plan

A live support chat where **the AI answers first**, holds a real conversation,
and **escalates to a human admin** for anything complex. Any admin can take over;
the AI is just the first face. Built to run **$0** on infrastructure you already
use (Supabase + Cloudflare + Resend).

---

## Goals & behavior

- Floating chat widget on all customer-facing pages.
- AI greets, answers FAQ/policy/shipping/returns questions, and looks up order
  status on request.
- On "complex" cases (explicit request for a human, low confidence, or
  sensitive intents like refunds/complaints/payment disputes) it **escalates**:
  the thread enters the admin "Live Chat" queue and admins are notified.
- **Any admin** can claim a thread and chat the customer live; the AI goes
  silent (or "suggest-only") once a human is engaged.
- Full history persisted; customer can resume their thread on return.

## Free-tier stack (nothing new to pay for)

| Need | Piece | Tier |
|---|---|---|
| Live two-way messaging | Supabase Realtime | free (already used in `dashboard.js`/`orders.js`) |
| Storage / history | Supabase Postgres | free |
| The AI brain | Cloudflare Workers AI *(primary)* or Groq/Gemini free tier *(alt)* | free |
| Server logic (call LLM safely) | Cloudflare Worker route `/api/support` *or* Supabase Edge Function | free |
| Notify offline admins | Resend | free (already wired) |

The backend is written behind a small `askLLM()` adapter so the provider can be
swapped without touching anything else.

---

## Conversation lifecycle

```
 [ai]  ── customer chats, bot answers ──┐
   │   escalate: "talk to a human" / low confidence / refund·complaint·payment
   ▼
[needs_human] ── enters admin Live Chat queue; admins pinged (realtime + email)
   │   an admin clicks "Take over"
   ▼
[with_admin] ── admin chats live; AI auto-reply OFF (optional suggest mode)
   │   resolved / idle timeout
   ▼
[resolved]
```

**Rule:** the AI auto-replies **only while `status = 'ai'`.** In every other
state it just records the customer's message and pings the assigned admin.

## Data-flow architecture

```
Customer widget ──POST /api/support──▶  Backend function
   ▲   │                                  1. verify access_token
   │   │ (HTTP: AI reply)                 2. store customer message
   │   ▼                                  3. if status='ai': build context
   │ broadcast channel  ◀───────────────    (FAQ + history + order lookup)
   │ convo:<token>                          → askLLM() → store AI reply
   │                                       4. escalation check → maybe status=needs_human
   │                                          + Resend email to admins
Admin console ──postgres_changes realtime──▶ support_conversations / support_messages
        (authenticated, RLS via is_admin())
```

- **Admin side** uses `postgres_changes` realtime (same pattern you already run),
  gated by `is_admin()`.
- **Customer side** receives live admin replies via a **broadcast channel keyed
  on the conversation's unguessable token** (no table read access needed).

---

## Data model (Phase 1 SQL → `setup/support-chat.sql`)

```sql
support_conversations
  id              uuid pk default gen_random_uuid()
  access_token    uuid default gen_random_uuid()   -- customer's bearer secret
  status          text default 'ai'                -- ai|needs_human|with_admin|resolved
  customer_name   text                              -- captured at escalation
  customer_email  text
  assigned_admin  uuid references auth.users        -- who took over
  page_url        text                              -- where chat started
  last_message_at timestamptz default now()
  last_preview    text
  unread_admin    int default 0
  created_at      timestamptz default now()

support_messages
  id              uuid pk default gen_random_uuid()
  conversation_id uuid references support_conversations on delete cascade
  role            text   -- 'customer' | 'ai' | 'admin' | 'system'
  body            text
  admin_id        uuid references auth.users        -- when role='admin'
  created_at      timestamptz default now()
```

Plus settings (extend `store_settings`): `support_enabled`, `support_greeting`,
`support_kb` (the FAQ/policy text the AI is grounded on).

## Security / RLS (the crux — anonymous customers)

The anon role is shared, so we **never give anon direct table access**. Instead:

- **Anon customers** interact only through `SECURITY DEFINER` RPCs gated by
  `access_token` (mirrors your `get_order_status` pattern):
  - `support_start()` → returns `{conversation_id, access_token}`
  - `support_post(p_conversation_id, p_access_token, p_body)` → inserts customer msg
  - `support_fetch(p_conversation_id, p_access_token)` → returns that thread only
  - `support_set_contact(...)` → save name/email at escalation
  Each verifies the token and touches only the matching conversation.
- **Admins** (`authenticated` + `is_admin()`): full RLS read/write on both tables.
- **Realtime to the customer**: a trigger on `support_messages` calls
  `realtime.send()` / `realtime.broadcast_changes()` to topic
  `convo:<access_token>`; the widget subscribes to that topic. No table SELECT
  for anon → nothing leaks even if RLS is misconfigured.
- **Rate limiting**: the backend caps messages per conversation per minute and
  per IP, protecting both the LLM quota and against abuse.

> Ties into your security-audit history: admins gated by `is_admin()` (not
> `auth.role()`), anon fully RPC-mediated, token is an unguessable bearer like
> your order links.

---

## Step-by-step implementation

### Phase 1 — Database & security  (`setup/support-chat.sql`)
1. Create `support_conversations` + `support_messages` (above).
2. Enable RLS; add `is_admin()` policies for admins.
3. Add the four `SECURITY DEFINER` RPCs (`support_start/post/fetch/set_contact`)
   with `access_token` checks; `grant execute` to `anon`.
4. Add the broadcast trigger on `support_messages` → `convo:<access_token>`.
5. Add `support_enabled / support_greeting / support_kb` defaults to
   `store_settings` (+ `DEFAULT_SETTINGS` in `src/supabase.js`).
6. Add both tables to the Realtime publication (for the admin postgres_changes).

### Phase 2 — AI backend  (`/api/support`)
**Primary: Cloudflare Worker route** (no external key)
1. Add a Worker entry + `[ai]` binding in `wrangler.jsonc`; route `/api/support`
   to run before static assets.
2. Implement handler: verify token → store customer msg (service-role, secret in
   CF) → if `status='ai'`, assemble context = `support_kb` + last N messages
   (+ order status via existing `get_order_status` when an order # + email are
   present) → `askLLM()` → store AI reply → return it.
3. **Escalation check**: explicit-human regex, sensitive-intent keywords, or the
   model emitting an `[[ESCALATE]]` sentinel → set `status='needs_human'`, insert
   a `system` message, and send a Resend email to admins.
4. **Rate limit** + a graceful "let me get a teammate" fallback if the LLM errors
   or is over quota.

**Alternative: Supabase Edge Function** (`supabase/functions/support-chat`) calling
Groq/Gemini free tier with the key in Supabase secrets — same logic, fits your
existing edge-function deploy flow. Pick one; the rest of the app doesn't change.

### Phase 3 — Customer chat widget  (`src/support-widget.js` + CSS)
1. Floating bubble + slide-up panel, brand-styled (gold/ivory, serif header).
2. Bootstrap: read `ngl_support` token from `localStorage`; if absent, call
   `support_start()` and store it; load history via `support_fetch()`.
3. Send: optimistic-append customer message → `POST /api/support` → append AI
   reply; typing indicator during the call.
4. Subscribe to broadcast `convo:<token>` for live **admin** replies + "admin is
   typing".
5. Escalation UX: when status flips to `needs_human`, show a small "Connecting
   you with our team — leave your name & email so we can follow up" form
   (`support_set_contact`).
6. Inject `<script type="module" src="/src/support-widget.js">` on customer
   pages: `home`, `shop`, `support`, `contact`, `track-order`, `checkout`,
   `order-confirm`.

### Phase 4 — Admin "Live Chat" console  (`admin/support.html` + `src/support-admin.js`)
1. New admin page; register in `vite.config.js` and add to the sidebar
   (`renderSidebar` in `admin.js`); guard with `requireAdmin` (any admin).
2. Left: conversation queue ordered **needs_human → with_admin (mine/others) →
   ai → resolved**, with unread badges; right: the selected thread.
3. **Take over** button → `status='with_admin'`, `assigned_admin=me` (AI silenced);
   reply box inserts `role='admin'` messages (→ broadcast to customer);
   **Resolve** button → `status='resolved'`.
4. Realtime via `postgres_changes` on both tables (RLS `is_admin()`) → live
   updates + a toast/badge when a new chat needs a human.

### Phase 5 — Knowledge base & settings (admin CMS)
1. Add `support_kb` (FAQ/policies the AI is grounded on), `support_greeting`, and
   an on/off `support_enabled` toggle to the Content & Socials CMS
   (`admin/cms.html` + `src/cms.js`).
2. Seed `support_kb` from your existing `support.html` content (shipping area =
   Metro Cebu, payment methods, returns window, waterproof care, etc.).

### Phase 6 — Polish & safeguards
- Accessibility: `role="log"`/`aria-live` on the transcript, `:focus-visible`,
  44px targets, `prefers-reduced-motion`, keyboard send, focus management.
- Performance: lazy-init the widget (no LLM/model weight on page load); load chat
  history only when opened.
- Quota guardrails: per-conversation + per-IP rate limits; cache common answers;
  fallback to escalation when the LLM is unavailable.
- Analytics: counts of AI-resolved vs escalated (reuse an engagement table).

---

## Config & secrets (set once)

- **Cloudflare**: enable Workers AI; `[ai]` binding in `wrangler.jsonc`; secrets
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only).
  *(Alt path: Supabase secret `GROQ_API_KEY`/`GEMINI_API_KEY` + reuse Resend secrets.)*
- **Resend**: reuse existing `RESEND_API_KEY`, `ADMIN_EMAIL`, `FROM_EMAIL`.

## Activation checklist (manual, in order)
1. Run `setup/support-chat.sql` in Supabase; confirm the Realtime publication
   includes both tables.
2. In the Cloudflare **Pages** project → **Settings**:
   - **Functions → Bindings** → add a **Workers AI** binding named `AI`.
   - **Environment variables & secrets** → add `SUPABASE_URL`,
     `SUPABASE_SERVICE_ROLE_KEY` (Secret), `RESEND_API_KEY` (Secret),
     `ADMIN_EMAIL`, `FROM_EMAIL` (optional: `AI_MODEL`, `STORE_URL`).
   Then push to GitHub — Pages auto-deploys `functions/api/support.js` to `/api/support`.
3. Set `support_kb` + `support_greeting` and flip `support_enabled = true` in the
   Content & Socials CMS.
4. Smoke test: customer chat → AI answer → ask for a human → admin gets pinged →
   admin takes over → customer sees the human reply live.

> Local note: `npm run dev` (Vite) does **not** run the Function, so `/api/support`
> is unavailable there. To exercise it locally: `npm run build`, then
> `npx wrangler pages dev dist` with the same vars in a `.dev.vars` file.

## Cost & free-tier reality
All components sit on free tiers. The only variable cost risk is LLM volume;
rate limits + caching + escalation-fallback keep a small store comfortably inside
free limits. No API key is ever exposed to the browser.

## Rollback
Entirely additive: new tables, one backend route, two new frontend modules, one
admin page. Flip `support_enabled = false` to hide the widget instantly; remove
the script tags / drop the tables to fully remove.

## Defaults chosen (say the word to change)
- LLM: **Cloudflare Workers AI** primary (no external key) — Supabase+Groq/Gemini
  is the drop-in alternative.
- Identity: **anonymous to start** (localStorage token), **name+email at escalation**.
- Knowledge: **FAQ/policies + live order-status lookup** via `get_order_status`.

## Runtime reference
- Existing realtime pattern: `supabase.channel(name).on('postgres_changes', …).subscribe()`
  (`src/dashboard.js`, `src/orders.js`).
- Admin helpers: `requireAdmin`, `renderSidebar`, `showToast` (`src/admin.js`).
- Order lookup RPC: `get_order_status` (used by `src/track-order.js`).
- Email: Resend via existing Edge Function pattern (`setup/order-emails.sql`).
- Settings: `store_settings` + `DEFAULT_SETTINGS` (`src/supabase.js`), CMS in
  `admin/cms.html` + `src/cms.js`.
