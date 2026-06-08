/* ============================================================
   NGL Accessories — Supabase Client
   ============================================================ */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ── Product helpers ─────────────────────────────────────── */
export async function getProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('*, inventory(*)')
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

/* ── Admin helpers ───────────────────────────────────────── */
export async function getAdmins() {
  const { data, error } = await supabase.from('admins').select('*').order('created_at');
  if (error) throw error;
  return data;
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
