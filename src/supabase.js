/* ============================================================
   NGL Accessories — Supabase Client
   ============================================================ */
import { createClient } from '@supabase/supabase-js';
import { validateConfig } from './try-on/assets.js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ── Image caching proxy helper ───────────────────────────── */
// Rewrites a Supabase Storage URL to go through our Cloudflare Worker's
// /img/* route, which caches the image at the edge for 30 days.
//
// Pass `size` to get a resized copy (Supabase image transformations): the
// photo is scaled to fit inside a size×size box — never cropped — and served
// as WebP. Uploads are 1–3 MB originals, so always pass a size for display.
//
// Usage:  cfImg(product.image_url, 600)   // card
//         cfImg(product.image_url)        // untouched original
const SUPABASE_BASE = (SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_STORAGE_PREFIX = `${SUPABASE_BASE}/storage/v1/object/public/`;

export function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function cfImg(url, size) {
  // Not a Supabase Storage URL (or already rewritten) — return as-is.
  if (!url || !url.startsWith(SUPABASE_STORAGE_PREFIX)) return url || '';
  const path = url.slice(SUPABASE_STORAGE_PREFIX.length);
  const qs = size ? `?width=${size}&height=${size}&resize=contain&quality=75` : '';
  // In local dev the Worker proxy doesn't run, so hit Supabase directly.
  if (import.meta.env.DEV) {
    return size ? `${SUPABASE_BASE}/storage/v1/render/image/public/${path}${qs}` : url;
  }
  return `/img/${path}${qs}`;
}

/* ── Product helpers ─────────────────────────────────────── */
// Public storefront read. Explicit column list ON PURPOSE: cost_price /
// profit are business-sensitive and the anon role is column-revoked from
// reading them at the DB level (see setup/security-hardening.sql), so a
// `select('*')` here would fail for anonymous visitors anyway.
const PUBLIC_PRODUCT_COLS =
  'id, name, collection, category, price, description, image_url, tags, is_active, created_at, likes_count';

export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select(`${PUBLIC_PRODUCT_COLS}, inventory(*)`)
    .eq('is_active', true)
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function trackEngagement(productId, type) {
  try {
    const { error } = await supabase.rpc('increment_engagement', {
      product_id: productId,
      type: type
    });
    if (error) console.error('Engagement tracking failed:', error);
  } catch (err) {
    console.error('Engagement tracking error:', err);
  }
}

export async function getAllProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*, inventory(*)')
    .order('created_at');
  if (error) throw error;
  return data;
}

export async function upsertProduct(product) {
  const { data, error } = await supabase
    .from('products')
    .upsert(product)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').update({ is_active: false }).eq('id', id);
  if (error) throw error;
}

/* ── Inventory helpers ───────────────────────────────────── */
export async function updateStock(productId, stock, threshold) {
  const { error } = await supabase
    .from('inventory')
    .upsert({ product_id: productId, stock, low_stock_threshold: threshold }, { onConflict: 'product_id' });
  if (error) throw error;
}

export async function decrementStock(productId, qty) {
  const { data: inv } = await supabase.from('inventory').select('stock').eq('product_id', productId).single();
  if (!inv) return;
  const newStock = Math.max(0, inv.stock - qty);
  await supabase.from('inventory').update({ stock: newStock }).eq('product_id', productId);
}

/* ── Order helpers ───────────────────────────────────────── */
export function generateOrderNumber() {
  const now  = new Date();
  const date = now.toISOString().slice(0,10).replace(/-/g,'');
  const rand = Math.floor(Math.random() * 9000) + 1000;
  return `NGL-${date}-${rand}`;
}

export async function createOrder(orderData, items) {
  const { data, error } = await supabase.rpc('create_order_safely', {
    p_order_data: orderData,
    p_items: items.map(item => ({
      product_id:   item.product_id,
      product_name: item.product_name,
      price:        Number(item.price),
      quantity:     item.quantity,
    }))
  });
  if (error) throw error;
  return data;
}

export async function getOrders(filters = {}) {
  let q = supabase
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false });
  if (filters.type)   q = q.eq('type', filters.type);
  if (filters.status) q = q.eq('status', filters.status);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function updateOrderStatus(id, status) {
  const { error } = await supabase.from('orders').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function updateOrderFulfilment(id, courier, trackingNumber) {
  const { error } = await supabase
    .from('orders')
    .update({ courier: courier || null, tracking_number: trackingNumber || null })
    .eq('id', id);
  if (error) throw error;
}

/* ── Store settings ──────────────────────────────────────── */
export const DEFAULT_SETTINGS = {
  shipping_fee:            '150',
  free_shipping_threshold: '1500',
  gcash_number:            '09XX-XXX-XXXX',
  gcash_name:              'NGL Accessories',
  bank_accounts:           'BDO: Account # 0012-3456-7890 · NGL Accessories\nBPI: Account # 1234-5678-90 · NGL Accessories',
  social_instagram:        'https://instagram.com/nglaccessories',
  social_tiktok:           'https://tiktok.com/@nglaccessories',
  social_facebook:         'https://facebook.com/nglaccessories',
  contact_email:           'support@nglaccessories.com',
  contact_phone:           '',
  support_enabled:         'false',
  support_greeting:        "Hi! 👋 I'm the NGL Accessories assistant. Ask me about your order, shipping, returns, or our jewelry — and I'll connect you with a teammate whenever you need a human.",
  support_kb:              '',
};

export async function getStoreSettings() {
  const { data, error } = await supabase.from('store_settings').select('key, value');
  if (error) throw error;
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries((data || []).map(r => [r.key, r.value])) };
}

export async function updateStoreSettings(settings) {
  const rows = Object.entries(settings).map(([key, value]) => ({ key, value: String(value) }));
  const { error } = await supabase.from('store_settings').upsert(rows);
  if (error) throw error;
}

/* Admin-only key/value settings (owner finances). Not store_settings: that table is public-read. */
export async function getAdminSetting(key) {
  const { data, error } = await supabase.from('admin_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function setAdminSetting(key, value) {
  const { error } = await supabase.from('admin_settings').upsert({ key, value: String(value), updated_at: new Date().toISOString() });
  if (error) throw error;
}

/* ── Support chat (AI customer support) ──────────────────────
   Anonymous customers reach the chat only through these token-gated
   RPCs (defined in setup/support-chat.sql). See docs/SUPPORT_BOT_PLAN.md. */
export async function startSupportChat(pageUrl) {
  const { data, error } = await supabase.rpc('support_start', { p_page_url: pageUrl || null });
  if (error) throw error;
  return data; // { conversation_id, access_token, greeting }
}

export async function fetchSupportThread(conversationId, accessToken) {
  const { data, error } = await supabase.rpc('support_fetch', {
    p_conversation_id: conversationId,
    p_access_token: accessToken,
  });
  if (error) throw error;
  return data || []; // [{ id, role, body, created_at }]
}

export async function postSupportMessage(conversationId, accessToken, body) {
  const { data, error } = await supabase.rpc('support_post', {
    p_conversation_id: conversationId,
    p_access_token: accessToken,
    p_body: body,
  });
  if (error) throw error;
  return data; // { id, status }
}

export async function setSupportContact(conversationId, accessToken, name, email) {
  const { error } = await supabase.rpc('support_set_contact', {
    p_conversation_id: conversationId,
    p_access_token: accessToken,
    p_name: name || null,
    p_email: email || null,
  });
  if (error) throw error;
}

/* ── Shipping zones (province → zone rate card) ───────────── */
// Returns the zone rate card + the province→zone map. The checkout
// uses this to PREVIEW the fee; create_order_safely() recomputes it
// server-side from the same tables so the charged total is trusted.
export async function getShippingConfig() {
  const [zonesRes, provincesRes] = await Promise.all([
    supabase.from('shipping_zones').select('*').order('sort_order'),
    supabase.from('province_zones').select('province, zone_id').order('province'),
  ]);
  if (zonesRes.error) throw zonesRes.error;
  if (provincesRes.error) throw provincesRes.error;
  return { zones: zonesRes.data || [], provinces: provincesRes.data || [] };
}

/* ── Sales summary ───────────────────────────────────────── */
/* ── Storage helpers ─────────────────────────────────────── */
// Every byte stored gets re-served on each cache miss (Supabase egress), so
// re-encode to ≤maxEdge (default 1600px) WebP before upload. WebP keeps PNG transparency.
// Falls back to the original if the browser can't encode WebP or it's no smaller.
async function shrinkImage(file, maxEdge = 1600, quality = 0.82) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale  = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/webp', quality));
    if (blob && blob.type === 'image/webp' && blob.size < file.size) return { body: blob, ext: 'webp' };
  } catch { /* undecodable here — upload as-is */ }
  return { body: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase() };
}

// Filenames are random and never overwritten, so a 1-year cache is safe.
const ONE_YEAR = '31536000';

export async function uploadProductImage(file) {
  const { body, ext } = await shrinkImage(file);
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, body, { cacheControl: ONE_YEAR, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

/* ── Try-on helpers ──────────────────────────────────────── */
// Earring try-on placement settings (supabase/migrations/…_try-on.sql).
// Config objects follow the contract in src/try-on/assets.js / docs/plan.md.
const TRY_ON_BUCKET = 'try-on-assets';
const tryOnUrl = (path) =>
  path ? cfImg(supabase.storage.from(TRY_ON_BUCKET).getPublicUrl(path).data.publicUrl) : null;
// Works for both /img/try-on-assets/<path> and the dev-mode Supabase URL.
const tryOnPath = (url) => (url ? url.split(`/${TRY_ON_BUCKET}/`)[1] ?? null : null);

// DB row → contract-shaped config, unvalidated (admin drafts can be incomplete).
const rowToRawConfig = (r) => ({
  productId: r.product_id,
  version: r.config_version,
  enabled: r.enabled,
  assets: { left: tryOnUrl(r.asset_left_path), right: tryOnUrl(r.asset_right_path) },
  mirrorLeftForRight: r.mirror_left_for_right,
  anchor: { left: r.anchor_left, right: r.anchor_right },
  offset: { left: r.offset_left, right: r.offset_right },
  rotationDeg: { left: r.rotation_left_deg, right: r.rotation_right_deg },
  scaleRatio: r.scale_ratio,
  lengthMm: r.product_length_mm,
});

// Published configs for the shop: one query per page load, never per frame.
// Empty Map when the build flag is off or the query fails — the shop works without it.
let tryOnConfigs = null;
export function getTryOnConfigs() {
  if (import.meta.env.VITE_TRY_ON_ENABLED !== 'true') return Promise.resolve(new Map());
  tryOnConfigs ??= supabase.from('product_try_on_configs').select('*').eq('enabled', true)
    .then(({ data, error }) => {
      if (error) { tryOnConfigs = null; console.warn('Try-on configs unavailable:', error.message); return new Map(); }
      const map = new Map();
      for (const row of data) {
        const { ok, config } = validateConfig(rowToRawConfig(row));
        if (ok) map.set(config.productId, config);
      }
      return map;
    });
  return tryOnConfigs;
}

// Admin editor: the row as a raw config (drafts may be invalid), or null if none yet.
export async function getTryOnConfigAdmin(productId) {
  const { data, error } = await supabase
    .from('product_try_on_configs').select('*').eq('product_id', productId).maybeSingle();
  if (error) throw error;
  return data ? rowToRawConfig(data) : null;
}

// Save a config. Publishing (enabled: true) must validate first; drafts may be
// partial — the DB CHECKs/trigger/RLS are the real gate either way.
export async function upsertTryOnConfig(config) {
  if (config.enabled) {
    const { ok, errors } = validateConfig(config);
    if (!ok) throw Object.assign(new Error('Invalid try-on config'), { errors });
  }
  const { error } = await supabase.from('product_try_on_configs').upsert({
    product_id: config.productId,
    enabled: config.enabled === true,
    asset_left_path: tryOnPath(config.assets?.left),
    asset_right_path: tryOnPath(config.assets?.right),
    mirror_left_for_right: config.mirrorLeftForRight === true,
    anchor_left: config.anchor.left, anchor_right: config.anchor.right,
    offset_left: config.offset.left, offset_right: config.offset.right,
    rotation_left_deg: config.rotationDeg.left, rotation_right_deg: config.rotationDeg.right,
    scale_ratio: config.scaleRatio,
    product_length_mm: config.lengthMm ?? null,
    config_version: config.version ?? 1,
  }, { onConflict: 'product_id' });
  if (error) throw error;
}

// Upload one earring cutout. Immutable path (never overwritten), pre-sized to
// ≤1024px because Supabase image transforms aren't on the Free plan.
// Returns the URL to store in config.assets[side].
export async function uploadTryOnAsset(file, productId, side) {
  if (side !== 'left' && side !== 'right') throw new Error('side must be "left" or "right"');
  const { body, ext } = await shrinkImage(file, 1024, 0.9);
  if (ext !== 'webp' && ext !== 'png') throw new Error('Use a transparent PNG or WebP image.');
  const path = `${productId}/${side}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(TRY_ON_BUCKET)
    .upload(path, body, { cacheControl: ONE_YEAR, upsert: false, contentType: `image/${ext}` });
  if (error) throw error;
  return tryOnUrl(path);
}

// Upload a customer's proof-of-payment screenshot (anonymous checkout).
// Random filename → the public URL is unguessable.
export async function uploadPaymentProof(file) {
  const { body, ext } = await shrinkImage(file);
  const path = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage
    .from('payment-proofs')
    .upload(path, body, { cacheControl: ONE_YEAR, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('payment-proofs').getPublicUrl(path);
  return data.publicUrl;
}

// Attach the uploaded proof to a just-created pending order (anon-safe RPC).
export async function attachPaymentProof(orderId, proofUrl) {
  const { error } = await supabase.rpc('attach_payment_proof', {
    p_order_id:  orderId,
    p_proof_url: proofUrl,
  });
  if (error) throw error;
}

/* ── Admin helpers ───────────────────────────────────────── */
export async function getAdmins() {
  const { data, error } = await supabase.rpc('get_admin_users');
  if (error) throw error;
  return data || [];
}

export async function getCurrentAdmin() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Error reading admin profile in getCurrentAdmin:', error);
    return null;
  }
  
  if (!admin) {
    console.warn('No admin profile found for the current auth user.');
    return null;
  }

  return { ...admin, email: user.email };
}

/* ── Tasks helpers ───────────────────────────────────────── */
export async function getTasks(filters = {}) {
  let query = supabase.from('admin_tasks').select('*').order('created_at', { ascending: false });
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.assigned_to) query = query.eq('assigned_to', filters.assigned_to);
  if (filters.task_type) {
    query = query.eq('task_type', filters.task_type);
  } else {
    query = query.eq('task_type', 'kanban'); // Default for Kanban board
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createTask(taskData) {
  const { data, error } = await supabase.from('admin_tasks').insert(taskData).select().single();
  if (error) throw error;
  return data;
}

export async function updateTask(id, updates) {
  const { data, error } = await supabase.from('admin_tasks').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from('admin_tasks').delete().eq('id', id);
  if (error) throw error;
}

/* ── Expenses ────────────────────────────────────────────── */

export async function getExpenses() {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function upsertExpense(expenseData) {
  const { data, error } = await supabase
    .from('expenses')
    .upsert(expenseData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(id) {
  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
