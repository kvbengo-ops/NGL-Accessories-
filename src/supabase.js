/* ============================================================
   NGL Accessories — Supabase Client
   ============================================================ */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

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
export async function getSalesSummary(days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from('sales_summary')
    .select('*')
    .gte('sale_date', since.toISOString());
  if (error) throw error;
  return data;
}

/* ── Storage helpers ─────────────────────────────────────── */
export async function uploadProductImage(file) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('product-images').getPublicUrl(path);
  return data.publicUrl;
}

// Upload a customer's proof-of-payment screenshot (anonymous checkout).
// Random filename → the public URL is unguessable.
export async function uploadPaymentProof(file) {
  const ext  = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `proofs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage
    .from('payment-proofs')
    .upload(path, file, { cacheControl: '3600', upsert: false });
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
