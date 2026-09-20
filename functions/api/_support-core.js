/**
 * Shared AI customer-support logic — used by BOTH:
 *   • the Cloudflare Pages Function  (functions/api/support.js)  → production
 *   • the Vite dev middleware        (vite.config.js)           → `npm run dev`
 *
 * Runtime-agnostic: uses only fetch + crypto (Node 18+ and the Workers runtime).
 * LLM = Groq if GROQ_API_KEY is set, otherwise Google Gemini. Answers are
 * grounded in support_kb; the model never invents orders/prices/policies.
 *
 * env keys:
 *   SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *   GROQ_API_KEY?, GROQ_MODEL? (default 'openai/gpt-oss-120b'),
 *   GEMINI_API_KEY?, GEMINI_MODEL? (default 'gemini-2.5-flash'),
 *   RESEND_API_KEY?, ADMIN_EMAIL?, FROM_EMAIL?, STORE_URL?
 */

function sbBase(env) {
  return env.SUPABASE_URL || env.VITE_SUPABASE_URL;
}
function sbHeaders(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}
async function sbGet(env, path) {
  const res = await fetch(`${sbBase(env)}/rest/v1/${path}`, { headers: sbHeaders(env) });
  if (!res.ok) throw new Error(`supabase GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}
async function sbInsert(env, table, row, returnRep = false) {
  const res = await fetch(`${sbBase(env)}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders(env, returnRep ? { Prefer: 'return=representation' } : {}),
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`supabase INSERT ${table} -> ${res.status} ${await res.text()}`);
  return returnRep ? res.json() : null;
}
async function sbPatch(env, path, patch) {
  const res = await fetch(`${sbBase(env)}/rest/v1/${path}`, {
    method: 'PATCH', headers: sbHeaders(env), body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`supabase PATCH ${path} -> ${res.status}`);
}
async function sbRpc(env, fn, args) {
  const res = await fetch(`${sbBase(env)}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: sbHeaders(env), body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  return res.json();
}

// ── Gemini (free tier) ─────────────────────────────────────
async function askGemini(env, systemText, history, userText) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  // Gemini roles are 'user' / 'model'; the conversation must start with 'user'.
  let mapped = history
    .filter((h) => h.role !== 'system')
    .map((h) => ({ role: h.role === 'customer' ? 'user' : 'model', parts: [{ text: h.body }] }));
  while (mapped.length && mapped[0].role !== 'user') mapped.shift();
  const contents = [...mapped, { role: 'user', parts: [{ text: userText }] }];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
      }),
    },
  );
  if (!res.ok) throw new Error(`gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '').trim();
}

// ── Groq (OpenAI-compatible chat completions) ──────────────
async function askGroq(env, systemText, history, userText) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0.4,
      max_tokens: 400,
      messages: [
        { role: 'system', content: systemText },
        ...history
          .filter((h) => h.role !== 'system')
          .map((h) => ({ role: h.role === 'customer' ? 'user' : 'assistant', content: h.body })),
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!res.ok) throw new Error(`groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data?.choices?.[0]?.message?.content || '').trim();
}

// ponytail: key presence picks the provider — no provider registry, no
// cross-provider failover. Add failover only if Groq starts rate-limiting too.
function askLLM(env, systemText, history, userText) {
  return env.GROQ_API_KEY
    ? askGroq(env, systemText, history, userText)
    : askGemini(env, systemText, history, userText);
}

const ESCALATE_RE = /\b(human|agent|representative|real person|talk to (someone|a person|somebody)|speak (to|with))\b/i;
const SENSITIVE_RE = /\b(refund|charge ?back|dispute|complain(t|ts)?|scam|fraud|legal|broken|damaged|defective|wrong item|never (arrived|received)|missing)\b/i;
const ORDER_RE = /#?\b([A-Z]{0,4}-?\d{3,})\b/;

function ephemeral(body) {
  return { id: crypto.randomUUID(), role: 'ai', body, created_at: new Date().toISOString() };
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
async function notifyAdmins(env, lastMessage) {
  if (!env.RESEND_API_KEY || !env.ADMIN_EMAIL || !env.FROM_EMAIL) return;
  const storeUrl = env.STORE_URL || 'https://www.ngluxaries.store';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: env.ADMIN_EMAIL,
      subject: '🔔 A support chat needs a human',
      html:
        `<p>A customer chat was escalated and is waiting in the Live Chat queue.</p>` +
        `<p><strong>Last message:</strong> ${escapeHtml(lastMessage)}</p>` +
        `<p><a href="${storeUrl}/admin/support.html">Open Live Chat →</a></p>`,
    }),
  });
}

/**
 * Core handler. Returns { status, body } (transport-agnostic).
 * input: { conversation_id, access_token, message }
 */
export async function processSupport(input, env) {
  const conversation_id = input?.conversation_id;
  const access_token = input?.access_token;
  const message = input?.message;

  if (!conversation_id || !access_token || typeof message !== 'string') {
    return { status: 400, body: { error: 'conversation_id, access_token and message are required' } };
  }
  if (!sbBase(env) || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 500, body: { error: 'server missing Supabase config (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)', envKeys: Object.keys(env) } };
  }
  if (!env.GROQ_API_KEY && !env.GEMINI_API_KEY) {
    return { status: 500, body: { error: 'server missing GROQ_API_KEY / GEMINI_API_KEY' } };
  }

  const text = message.trim().slice(0, 4000);
  if (!text) return { status: 400, body: { error: 'empty message' } };

  // 1. Verify conversation + bearer token.
  const rows = await sbGet(
    env,
    `support_conversations?id=eq.${conversation_id}&select=id,access_token,status,customer_email&limit=1`,
  );
  const convo = rows?.[0];
  if (!convo || convo.access_token !== access_token) {
    return { status: 403, body: { error: 'invalid conversation token' } };
  }

  // 2. Rate limit.
  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await sbGet(
    env,
    `support_messages?conversation_id=eq.${conversation_id}&role=eq.customer&created_at=gte.${since}&select=id`,
  );
  if ((recent?.length || 0) >= 12) {
    return {
      status: 200,
      body: { status: convo.status, escalated: false, message: ephemeral("You're sending messages quickly — give me a moment to catch up 🙏") },
    };
  }

  // 3. History BEFORE storing the new message.
  const history =
    (await sbGet(
      env,
      `support_messages?conversation_id=eq.${conversation_id}&select=role,body&order=created_at.asc&limit=12`,
    )) || [];

  // 4. Persist the customer message (trigger broadcasts it + bumps the thread).
  await sbInsert(env, 'support_messages', { conversation_id, role: 'customer', body: text });

  // 5. Human-handled threads: store only, never auto-reply.
  if (convo.status !== 'ai') {
    return { status: 200, body: { status: convo.status, escalated: false, message: null } };
  }

  // 6. Grounding context.
  const settings = await sbGet(env, `store_settings?key=eq.support_kb&select=value`);
  const kb = settings?.[0]?.value || '';

  // The live catalogue. Without it the model has no product facts at all and
  // invents pieces the store doesn't carry (chokers, chandelier earrings...).
  // ponytail: whole active catalogue, one line each - fine at this store's size.
  // If it outgrows the context window, switch to a keyword search on `text`.
  const products = await sbGet(
    env,
    'products?is_active=eq.true&select=name,collection,category,price,inventory(stock)&order=name.asc&limit=200',
  );
  const catalog = (products || [])
    .map((pr) => {
      const inv = Array.isArray(pr.inventory) ? pr.inventory[0] : pr.inventory;
      const tags = [pr.collection, pr.category].filter(Boolean).join(', ');
      return `- ${pr.name}${tags ? ` (${tags})` : ''} - P${pr.price}` +
        (inv && inv.stock === 0 ? ' - OUT OF STOCK' : '');
    })
    .join('\n');

  let orderCtx = '';
  const om = text.match(ORDER_RE);
  if (om && convo.customer_email) {
    const order = await sbRpc(env, 'get_order_status', { p_order_number: om[1], p_email: convo.customer_email });
    if (order) orderCtx = `\n\nORDER LOOKUP (${om[1]}): ${JSON.stringify(order)}`;
  }

  const preEscalate = ESCALATE_RE.test(text) || SENSITIVE_RE.test(text);
  const system =
    'You are the friendly customer-support assistant for NGL Accessories, a premium Philippines jewelry brand. ' +
    'Reply warmly and concisely (2–4 sentences). Use ONLY the facts below — never invent orders, prices, or policies. ' +
    'CATALOGUE below is the complete list of what NGL sells. Recommend ONLY items named there, quoting the name exactly. ' +
    "If the customer asks for something not in CATALOGUE, say plainly that we don't carry it, then offer the closest item that IS listed. " +
    'Never describe a product, material, or feature that is not in CATALOGUE. ' +
    "If the customer needs a human (refunds, complaints, payment disputes, anything you're unsure of, or they ask for a person), " +
    "apologize briefly, say you'll connect them with a teammate, and end your reply with the token [[ESCALATE]].\n\n" +
    `FACTS:\n${kb}\n\nCATALOGUE (everything NGL sells):\n${catalog || '(catalogue unavailable - do not recommend specific products)'}${orderCtx}`;

  // 7. Generate, with a graceful fallback that still escalates.
  let reply = '';
  let escalated = preEscalate;
  try {
    reply = await askLLM(env, system, history, text);
    if (/\[\[ESCALATE\]\]/i.test(reply)) escalated = true;
    reply = reply.replace(/\[\[ESCALATE\]\]/gi, '').trim();
    if (!reply) reply = 'Thanks for reaching out! Let me connect you with a teammate so you get the best help.';
  } catch (err) {
    console.error('LLM error', err);
    reply = "I'm having a little trouble right now — let me get a teammate to help you. Could you share your name and email so we can follow up?";
    escalated = true;
  }
  if (preEscalate && !/teammate|team|connect|human/i.test(reply)) {
    reply += "\n\nI'll connect you with a teammate who can help further.";
  }

  // 8. Store the AI reply.
  const inserted = await sbInsert(env, 'support_messages', { conversation_id, role: 'ai', body: reply }, true);
  const aiMsg = inserted?.[0] || ephemeral(reply);

  // 9. Escalate: flip status, log a system note, notify admins (once).
  if (escalated) {
    await sbPatch(env, `support_conversations?id=eq.${conversation_id}`, { status: 'needs_human' });
    await sbInsert(env, 'support_messages', { conversation_id, role: 'system', body: 'Conversation escalated to a human.' });
    await notifyAdmins(env, text).catch((e) => console.error('email', e));
  }

  return {
    status: 200,
    body: {
      status: escalated ? 'needs_human' : 'ai',
      escalated,
      message: { id: aiMsg.id, role: 'ai', body: aiMsg.body, created_at: aiMsg.created_at },
    },
  };
}
