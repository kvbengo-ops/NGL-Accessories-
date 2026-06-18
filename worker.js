/**
 * Cloudflare Worker entrypoint (Workers + Static Assets deploy).
 *
 * The site is deployed as a Worker that serves the built SPA from ./dist via the
 * ASSETS binding. Workers do NOT auto-route the Pages-style `functions/` folder,
 * so the AI support endpoint is wired up explicitly here. It reuses the same
 * runtime-agnostic core as the Vite dev middleware (see _support-core.js).
 *
 * Worker env (dashboard → the Worker → Settings → Variables and Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Secret), GEMINI_API_KEY (Secret),
 *   GEMINI_MODEL? and optionally RESEND_API_KEY (Secret), ADMIN_EMAIL, FROM_EMAIL.
 */
import { processSupport } from './functions/api/_support-core.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/support') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      let input = {};
      try { input = await request.json(); } catch { /* invalid JSON → handled by core */ }
      try {
        const { status, body } = await processSupport(input, env);
        return new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        // Surface the real reason (missing env, bad Supabase key, etc.) as JSON.
        console.error('support worker error', err);
        return new Response(JSON.stringify({ error: String(err?.message || err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Everything else → static assets (SPA fallback via not_found_handling).
    return env.ASSETS.fetch(request);
  },
};
