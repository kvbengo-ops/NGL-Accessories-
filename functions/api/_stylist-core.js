import { cleanBrief, isOrderHelp } from '../../src/stylist-engine.js';
import { fetchCatalog, planRetrieval, retrieveProducts, generateAdvice } from './_stylist-rag.js';

export const fetchStylistCatalog = fetchCatalog;

export async function processStylist(input, env, { fetcher = fetch, allowAI = true } = {}) {
  if (!input || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000) return { status: 400, body: { error: 'Please use a message between 1 and 2,000 characters.' } };
  if (isOrderHelp(input.message)) return { status: 200, body: { message: 'Our customer-care team can help with that. You can track an order or open customer care below.', products: [], help: true, brief: cleanBrief(input.brief), mode: 'care' } };
  if (!allowAI || !env.GROQ_API_KEY) return { status: 503, body: { error: 'The AI stylist is unavailable right now. Please try again or browse the collection.', code: 'stylist_unavailable' } };
  const signal = AbortSignal.timeout(25000);
  try {
    const [catalog, brief] = await Promise.all([
      fetchCatalog(env, fetcher, signal),
      planRetrieval(input.message, input.brief, input.history, env, fetcher, signal),
    ]);
    const previousIds = Array.isArray(input.previousIds) ? input.previousIds.filter(id => typeof id === 'string').slice(0, 3) : [];
    const retrieval = retrieveProducts(catalog, brief, previousIds);
    const answer = await generateAdvice(input.message, input.history, brief, retrieval, env, fetcher, signal);
    return { status: 200, body: { ...answer, brief, mode: 'rag', as_of: new Date().toISOString(), grounding: { source: 'live_catalog', method: 'query_expanded_lexical', catalog_count: retrieval.catalogCount, eligible_count: retrieval.eligibleCount, retrieved_count: retrieval.products.length } } };
  } catch (error) {
    if (error.message === 'groq-rate-limit') return { status: 429, body: { error: `The AI stylist is receiving too many requests. Please try again in ${error.retryAfter} seconds. Your preferences are still here.`, code: 'provider_rate_limit', retry_after: error.retryAfter } };
    if (error.cause?.code === 'EACCES' || error.cause?.code === 'EPERM') return { status: 503, body: { error: 'This preview server cannot connect to the AI service. Please use the connected preview or try again after its connection is restored.', code: 'preview_network_blocked' } };
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return { status: 504, body: { error: 'The AI stylist took too long to respond. Please try again; your previous preferences are still here.', code: 'stylist_timeout' } };
    // Log only a bounded error class, never prompts, credentials or catalog bodies.
    const code = ['catalog', 'catalog-size', 'groq-unavailable', 'groq-output', 'groq-plan', 'groq-answer', 'groq-citation', 'groq-evidence', 'groq-attribute', 'groq-safety', 'groq-budget', 'groq-incomplete-set', 'groq-unverified-price'].includes(error.message) ? error.message : 'stylist-unavailable';
    console.warn('stylist request failed:', code);
    return { status: 503, body: { error: 'I couldn’t complete a grounded styling recommendation just now. Your preferences are still here. Please try again or browse the collection.', code: 'stylist_unavailable' } };
  }
}

export async function handleStylistRequest(request, env) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return reply({ error: 'Origin not allowed.' }, 403);
  let allowAI = false;
  if (env.STYLIST_LIMITER) {
    const { success } = await env.STYLIST_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
    if (!success) return reply({ error: 'A little pause—please try again in a minute.' }, 429);
    allowAI = env.STYLIST_AI_ENABLED === 'true';
  }
  try {
    const reader = request.body?.getReader();
    let size = 0, raw = '';
    const decoder = new TextDecoder();
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12000) { await reader.cancel(); return reply({ error: 'Message too large.' }, 413); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    let input;
    try { input = JSON.parse(raw); } catch { return reply({ error: 'Invalid message.' }, 400); }
    const result = await processStylist(input, env, { allowAI });
    return reply(result.body, result.status);
  } catch { return reply({ error: 'The stylist is unavailable. Please try again.' }, 503); }
}
