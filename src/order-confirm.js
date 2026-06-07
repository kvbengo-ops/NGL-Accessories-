/* ============================================================
   NGL — Order Confirmation Page
   ============================================================ */
import { supabase } from './supabase.js';

function formatPrice(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

(async () => {
  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');

  if (!id) {
    document.getElementById('confirm-order-number').textContent = 'Order not found';
    return;
  }

  const { data: order, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('id', id)
    .single();

  if (error || !order) {
    document.getElementById('confirm-order-number').textContent = 'Could not load order';
    return;
  }

  document.getElementById('confirm-order-number').textContent = order.order_number;
  document.getElementById('confirm-order-details').innerHTML = `
    <div class="confirm-detail-grid">
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">person</span>
        <span>${order.customer_name}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">mail</span>
        <span>${order.customer_email}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">home</span>
        <span>${order.delivery_address || '—'}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">payments</span>
        <span>${order.payment_method || '—'}</span>
      </div>
    </div>
    <div class="confirm-items">
      ${(order.order_items || []).map(item => `
        <div class="confirm-item-row">
          <span>${item.product_name} ×${item.quantity}</span>
          <span>${formatPrice(item.subtotal)}</span>
        </div>
      `).join('')}
    </div>
    <div class="confirm-total-row">
      <span>Total Paid</span>
      <span>${formatPrice(order.total)}</span>
    </div>
  `;

  // Animate check icon
  document.querySelector('.confirm-icon')?.classList.add('animated');
})();
