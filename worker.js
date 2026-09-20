/**
 * Cloudflare Worker entrypoint (Workers + Static Assets deploy).
 *
 * The site is deployed as a Worker that serves the built SPA from ./dist via the
 * ASSETS binding. Workers do NOT auto-route the Pages-style `functions/` folder,
 * so the AI support endpoint is wired up explicitly here. It reuses the same
 * runtime-agnostic core as the Vite dev middleware (see _support-core.js).
 *
 * Worker env (dashboard → the Worker → Settings → Variables and Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Secret), GROQ_API_KEY (Secret)
 *   or GEMINI_API_KEY (Secret) + GEMINI_MODEL?, and optionally
 *   RESEND_API_KEY (Secret), ADMIN_EMAIL, FROM_EMAIL.
 *
 * Image caching proxy: GET /img/<path>
 *   Fetches the image from Supabase Storage and caches it at Cloudflare's edge
 *   for 30 days (Cache-Control: public, max-age=2592000, immutable).
 *   First request goes to Supabase; every subsequent request is served instantly
 *   from the nearest Cloudflare data-centre — no origin roundtrip needed.
 */
import { processSupport } from './functions/api/_support-core.js';
import { handleStylistRequest } from './functions/api/_stylist-core.js';

/** Cache product images from Supabase Storage at Cloudflare's edge. */
async function handleImageProxy(request, env) {
  const cache = caches.default;

  // Return from edge cache if available (keyed on the full request URL).
  const cached = await cache.match(request);
  if (cached) return cached;

  // Build the upstream Supabase Storage URL from the /img/<rest> path.
  const url = new URL(request.url);
  const storagePath = url.pathname.replace(/^\/img\//, ''); // e.g. "products/ring-gold.jpg"
  const supabaseUrl = (env.SUPABASE_URL || 'https://vevzlrnwhckuekkvujhq.supabase.co')
    .replace(/\/$/, '');
  // A query string (?width=…&height=…&resize=contain, built by cfImg) asks for a
  // resized copy via Supabase image transformations.
  // ponytail: product-images only — transforms bill per distinct origin image,
  // so /img/ must not become a free resizer for every public bucket.
  const transform = url.search && storagePath.startsWith('product-images/');
  const endpoint = transform ? 'render/image' : 'object';
  const originUrl = `${supabaseUrl}/storage/v1/${endpoint}/public/${storagePath}${url.search}`;

  const originResp = await fetch(originUrl, {
    // Supabase only converts to WebP when the request says it's accepted;
    // without this every resize comes back as a (much larger) PNG.
    headers: { Accept: 'image/webp,image/*' },
    cf: { cacheEverything: true, cacheTtl: 2592000 }, // 30 days at Cloudflare layer
  });

  if (!originResp.ok) {
    // Don't cache errors — let the browser retry.
    return new Response('Image not found', { status: originResp.status });
  }

  // Clone headers and set a strong browser + CDN cache.
  const headers = new Headers(originResp.headers);
  headers.set('Cache-Control', 'public, max-age=2592000, immutable'); // 30 days
  headers.set('Vary', 'Accept-Encoding');

  const response = new Response(originResp.body, {
    status: originResp.status,
    headers,
  });

  // Store in edge cache for subsequent requests.
  await cache.put(request, response.clone());

  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/stylist') return handleStylistRequest(request, env);

    // Image caching proxy: /img/<supabase-storage-path>
    if (url.pathname.startsWith('/img/')) {
      return handleImageProxy(request, env);
    }

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
