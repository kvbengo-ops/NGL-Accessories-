/**
 * Cloudflare Pages Function — POST /api/support.
 * Thin transport wrapper around the shared core (also used by the Vite dev
 * middleware so the chat works locally on `npm run dev`). See _support-core.js.
 *
 * Pages env (dashboard → Settings → Environment variables & secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Secret), GROQ_API_KEY (Secret)
 *   or GEMINI_API_KEY (Secret), and optionally RESEND_API_KEY (Secret),
 *   ADMIN_EMAIL, FROM_EMAIL.
 */
import { processSupport } from './_support-core.js';

export async function onRequestPost({ request, env }) {
  let input = {};
  try { input = await request.json(); } catch { /* invalid JSON → handled below */ }
  try {
    const { status, body } = await processSupport(input, env);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // Surface the real reason instead of an opaque Cloudflare 500 so the cause
    // (missing env, bad Supabase key, etc.) is visible in the Network response.
    console.error('support function error', err);
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
