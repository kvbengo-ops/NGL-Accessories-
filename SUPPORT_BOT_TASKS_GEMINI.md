# Support Bot — Gemini Pro's Tasks (Customer Widget · Admin Console · UI)

You are building the **UI** for a live customer-support chat. An AI answers first;
complex chats **escalate to human admins**, and any admin can take over. The
**database + AI backend are built by Claude** — you build the two faces and wire
them to the **Shared Contract** at the bottom of this file.

**Full design:** `SUPPORT_BOT_PLAN.md`. **DB layer (already written):**
`setup/support-chat.sql`.

## Project context (you won't have prior chat history)
- **App:** NGL Accessories — premium Philippines jewelry e-commerce. Plain
  **HTML + CSS + vanilla JS**, bundled with **Vite** (multi-page; see
  `vite.config.js`). Backend is **Supabase**; the site deploys on **Cloudflare**.
- **Brand:** editorial luxury, ivory/gold. Fonts: **Cormorant Garamond** (serif)
  + **DM Sans** (sans). Design tokens live in `src/style.css`
  (e.g. `var(--gold-500)` = `#755b00`, `var(--gold-300)` = `#c9a84c`,
  `var(--font-serif)`, `var(--font-sans)`, `var(--charcoal-2)`, `var(--r-full)`).
  Match the existing look (see `contact.html`, `shop.html`).
- **Realtime** is already used in `src/dashboard.js` / `src/orders.js`
  (`supabase.channel(...).on('postgres_changes', …).subscribe()`) — copy that pattern.
- **Admin helpers** in `src/admin.js`: `requireAdmin`, `renderSidebar(title, admin)`,
  `showToast(msg, type)`. Admin pages live under `admin/` and import `/src/*.js`.
- Run locally: `npm run dev` → http://localhost:5173 .

## File ownership (do NOT edit Claude's files)
**You own:**
- `src/support-widget.js` (new) — customer chat widget
- `admin/support.html` (new) + `src/support-admin.js` (new) — admin Live Chat
- `src/style.css` — add styles (append; don't restructure existing rules)
- `vite.config.js` — add the `admin-support` input
- `src/admin.js` — add **one** sidebar nav entry (don't change existing logic)
- customer HTML pages — add **one** `<script>` tag each

**Do NOT touch (Claude owns):** `src/supabase.js`, `src/cms.js`, `admin/cms.html`,
`setup/*.sql`, the backend function, `wrangler.jsonc`.

---

## Tasks

- [ ] **G1 — Customer chat widget** (`src/support-widget.js`).
  - Floating bubble (bottom-right) + slide-up panel; brand-styled header.
  - **Gate on settings:** call `getStoreSettings()`; if `support_enabled !== 'true'`,
    render nothing.
  - **Bootstrap:** read `localStorage['ngl_support']`; if missing, call
    `startSupportChat(location.pathname)`, store `{conversation_id, access_token}`,
    and show the returned `greeting`. On open, load history via
    `fetchSupportThread(...)`.
  - **Send** uses the *Widget send algorithm* in the Contract (POST `/api/support`).
  - **Live replies:** subscribe to broadcast channel `convo:<access_token>`
    (Contract). Dedupe by `id`; ignore your own `customer` echoes.
  - **Escalation UX:** when a response has `escalated:true` (or status becomes
    `needs_human`/`with_admin`), show a small "Connecting you with our team — leave
    your name & email so we can follow up" form → `setSupportContact(...)`, then a
    calm "a teammate will reply here" state.
  - **Typing indicator** while awaiting the AI; disable send while in-flight.
- [ ] **G2 — Widget styling** (`src/style.css`): brand tokens; accessible —
  `aria-live="polite"` on the transcript (`role="log"`), `:focus-visible` rings,
  44px touch targets, `prefers-reduced-motion`, Enter-to-send + Shift+Enter newline,
  focus the input on open. No layout shift on the page.
- [ ] **G3 — Inject the widget** `<script type="module" src="/src/support-widget.js"></script>`
  before `</body>` on customer pages: `home.html`, `shop.html`, `support.html`,
  `contact.html`, `track-order.html`, `checkout.html`, `order-confirm.html`.
- [ ] **G4 — Admin Live Chat console** (`admin/support.html` + `src/support-admin.js`).
  - Guard with `requireAdmin`; `renderSidebar('Live Chat', admin)`.
  - Two-pane: left = conversation queue ordered **needs_human → with_admin
    (mine first) → ai → resolved**, with unread badges (`unread_admin`) and last
    preview; right = the selected thread.
  - **Take over / Reply / Resolve** per the Contract's *Admin actions*.
  - **Realtime:** `postgres_changes` on `support_messages` + `support_conversations`
    → live queue + thread updates; `showToast` when a chat enters `needs_human`.
  - Reset `unread_admin = 0` when a thread is opened.
- [ ] **G5 — Register the admin page:** add `'admin-support': resolve(__dirname,
  'admin/support.html')` to `vite.config.js`; add a "Live Chat" item to the admin
  sidebar in `src/admin.js`.
- [ ] **G6 — Admin console styling** (`src/style.css`): match the existing
  `admin-page` look; same accessibility bar as G2.

**Acceptance**
- Widget hidden when `support_enabled='false'`; visible and on-brand when `'true'`.
- Customer can send a message and receive an AI reply; asking for a human shows the
  contact form and a waiting state.
- Admin console lists threads live, can take over (AI goes silent), reply (customer
  sees it live via broadcast), and resolve.
- Passes a11y basics (keyboard, focus, reduced-motion, contrast).

**Working before Claude's backend lands:** the `/api/support` endpoint and applied
SQL are needed for the *full* loop. You can build + style against the Contract and
temporarily stub `/api/support` (return a canned `{status:'ai', escalated:false,
message:{...}}`) to develop the UI in isolation.

---

## SHARED CONTRACT
> Identical in both task files. Do not change one side without the other.

**Enums**
- conversation `status`: `ai` | `needs_human` | `with_admin` | `resolved`
- message `role`: `customer` | `ai` | `admin` | `system`

**Client storage:** `localStorage['ngl_support'] = { conversation_id, access_token }`

**Supabase RPCs** (in `setup/support-chat.sql`):
- `support_start(p_page_url)` → `{ conversation_id, access_token, greeting }`
- `support_fetch(p_conversation_id, p_access_token)` → `[{ id, role, body, created_at }]` (asc)
- `support_set_contact(p_conversation_id, p_access_token, p_name, p_email)` → void
- `support_post(p_conversation_id, p_access_token, p_body)` → `{ id, status }` _(available; widget uses `/api/support` instead)_

**Helper wrappers** (Claude adds to `src/supabase.js`; UI calls these):
- `startSupportChat(pageUrl)` → `{ conversation_id, access_token, greeting }`
- `fetchSupportThread(conversationId, accessToken)` → `message[]`
- `setSupportContact(conversationId, accessToken, name, email)` → void
- `getStoreSettings()` (exists) → includes `support_enabled` (`'true'|'false'`), `support_greeting`

**AI backend** (Claude builds): `POST /api/support`
- request: `{ conversation_id, access_token, message }`
- response 200: `{ status, escalated: boolean, message: { id, role:'ai', body, created_at } | null }`
- Stores **both** the customer message and the AI reply server-side. Returns a
  reply only when the thread was `ai`; in human mode returns `message: null`.

**Realtime**
- Customer (widget): `supabase.channel('convo:'+access_token).on('broadcast', { event:'message' }, ({payload}) => …)`; payload `{ id, conversation_id, role, body, created_at }`. Dedupe by `id`; ignore `role==='customer'` (own echo).
- Admin (console): `postgres_changes` on `support_messages` and `support_conversations` (RLS already allows `is_admin()`).

**Widget send algorithm**
1. submit → optimistic customer bubble.
2. `POST /api/support { conversation_id, access_token, message }`.
3. `response.message` → append AI bubble (dedupe by `id`).
4. `response.escalated` → show "leave name + email" form → `setSupportContact()`.
5. Human mode: customer waits; admin replies arrive via the broadcast channel.

**Admin actions** (console, under `is_admin()` RLS)
- Take over: `update support_conversations set status='with_admin', assigned_admin=<me>` → AI stays silent (backend replies only when `status='ai'`).
- Reply: `insert support_messages (conversation_id, role:'admin', body, admin_id)` → trigger broadcasts to the customer.
- Resolve: `status='resolved'`. Reset `unread_admin=0` when opening a thread.
