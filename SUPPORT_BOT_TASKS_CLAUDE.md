# Support Bot — Claude's Tasks (Backend · Data · Security · Integration)

**Owner:** Claude. **Pairs with:** `SUPPORT_BOT_TASKS_GEMINI.md` (UI).
**Design:** `SUPPORT_BOT_PLAN.md`. **DB layer:** `setup/support-chat.sql`.

**Why this half is mine:** the LLM call + escalation logic, RLS/security, and the
data/settings layer are correctness- and security-critical and depend directly on
the SQL already written. The UI is well-specified, so it parallelizes to Gemini.

---

## File ownership (avoid collisions)

**I own — Gemini must NOT edit:**
- `setup/support-chat.sql` ✅ (done)
- `src/supabase.js`
- `admin/cms.html`, `src/cms.js`
- backend function: `worker/support.js` (Cloudflare) **or** `supabase/functions/support-chat/` (+ `wrangler.jsonc` / secrets)

**Gemini owns — I must NOT edit:**
- `src/support-widget.js`, `admin/support.html`, `src/support-admin.js`
- `src/style.css`, `vite.config.js`, `src/admin.js`
- `<script>` tags inside customer HTML pages

---

## Tasks

- [x] **C1 — Phase 1 SQL.** `setup/support-chat.sql` (tables, RLS, RPCs, broadcast
  trigger, settings). _Action remaining:_ run it in Supabase; verify the
  `supabase_realtime` publication includes both tables and the RPC grants applied.
- [x] **C2 — `src/supabase.js`: data layer.** Add the three `support_*` keys to
  `DEFAULT_SETTINGS`, and add the helper wrappers the UI calls (see Contract):
  `startSupportChat`, `fetchSupportThread`, `setSupportContact` (and
  `postSupportMessage` for completeness).
- [x] **C3 — `POST /api/support` (the AI backend).** → `functions/api/support.js` (Cloudflare **Pages Function**, `onRequestPost`) Token verify → store the
  customer message (service role) → if `status='ai'`: assemble context
  (`support_kb` + last N messages + optional `get_order_status` lookup) →
  `askLLM()` (provider-agnostic; **Cloudflare Workers AI** primary) → store the
  AI reply → **escalation check** (explicit-human / sensitive-intent /
  `[[ESCALATE]]` sentinel) → set `status='needs_human'` + `system` message +
  **Resend** email to admins. Add **rate limiting** + graceful "let me get a
  teammate" fallback when the LLM errors/over quota. Respond per Contract.
- [x] **C4 — Backend config (Pages).** Bindings via the Cloudflare **Pages dashboard**: Workers AI binding named `AI` + env secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `ADMIN_EMAIL`, `FROM_EMAIL`). `wrangler.jsonc` left at its original Pages state. Deploy = `git push` (auto). Cloudflare: `[ai]` binding + `/api/support` route
  in `wrangler.jsonc`; secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, reuse
  `RESEND_*`. _(Alt path: Supabase Edge Function + Groq/Gemini free-tier key in
  Supabase secrets — same logic.)_
- [x] **C5 — CMS settings.** Add a `support_enabled` toggle + `support_greeting` +
  `support_kb` editor to `admin/cms.html` + `src/cms.js` (so KB/greeting/on-off
  are editable; backend reads them).
- [x] **C6 — Keep the Contract in sync** (identical block in both task files) and
  update the activation checklist in `SUPPORT_BOT_PLAN.md`.

**Acceptance:** `curl /api/support` on an `ai` thread returns a grounded reply;
"can I talk to a person" flips the thread to `needs_human` and emails admins; the
over-quota path returns a friendly fallback instead of erroring.

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
