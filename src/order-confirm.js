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
    .rpc('get_order_public', { p_order_id: id });

  if (error || !order) {
    document.getElementById('confirm-order-number').textContent = 'Could not load order';
    return;
  }

  // Older orders (placed before zone shipping) have no `shipping` column —
  // derive it from total − subtotal so the breakdown still balances.
  const shippingVal = order.shipping != null
    ? Number(order.shipping)
    : Math.max(0, Number(order.total) - Number(order.subtotal));

  const deliveryMethod = order.delivery_method || '';
  const deliveryArea   = order.province || '';
  const isCourier      = /maxim|movit/i.test(deliveryMethod);
  // Local model: meetup is free, Maxim/Movit fare is paid to the rider.
  const deliveryValue  = shippingVal > 0
    ? formatPrice(shippingVal)
    : (isCourier ? 'Paid to rider' : 'Free');

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
        <span class="material-symbols-outlined">local_shipping</span>
        <span>${[deliveryMethod, deliveryArea].filter(Boolean).join(' · ') || '—'}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">payments</span>
        <span>${order.payment_method || '—'}</span>
      </div>
    </div>
    <div class="confirm-items">
      ${(order.items || []).map(item => `
        <div class="confirm-item-row">
          <span>${item.product_name} ×${item.quantity}</span>
          <span>${formatPrice(item.subtotal)}</span>
        </div>
      `).join('')}
    </div>
    <div class="confirm-item-row">
      <span>Subtotal</span>
      <span>${formatPrice(order.subtotal)}</span>
    </div>
    <div class="confirm-item-row">
      <span>Delivery${deliveryMethod ? ` · ${deliveryMethod}` : ''}</span>
      <span>${deliveryValue}</span>
    </div>
    <div class="confirm-total-row">
      <span>Total Paid</span>
      <span>${formatPrice(order.total)}</span>
    </div>
  `;

  // Deep-link the tracker with this order pre-filled (track-order.js
  // auto-submits when both order + email are present in the URL).
  const trackLink = document.getElementById('confirm-track-link');
  if (trackLink && order.order_number && order.customer_email) {
    const q = new URLSearchParams({
      order: order.order_number,
      email: order.customer_email,
    });
    trackLink.href = `/track-order.html?${q.toString()}`;
  }

  // Animate check icon
  document.querySelector('.confirm-icon')?.classList.add('animated');
})();
