/* ============================================================
   NGL — Order Confirmation Page
   ============================================================ */
import { supabase } from './supabase.js';

function formatPrice(n) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// The confirmation is reached right after checkout, in the same tab. checkout.js
// stashes the order's email there so we can prove ownership to get_order_public()
// without putting the email (or full PII) in a shareable URL.
function readStashedOrder(id) {
  try {
    const s = JSON.parse(sessionStorage.getItem('ngl_confirm') || '{}');
    return s.id === id ? s : {};
  } catch {
    return {};
  }
}

// Fallback when we can't prove ownership (e.g. link opened in a new tab/device,
// so the email isn't available). The order is placed — just point to the tracker.
function renderFallback(orderNumber) {
  document.getElementById('confirm-order-number').textContent = orderNumber || 'Order placed';
  const details = document.getElementById('confirm-order-details');
  if (details) {
    details.innerHTML = `
      <p style="color:rgba(0,0,0,0.6);line-height:1.7;">
        Your order is confirmed. For the full details and live status, open
        <a href="/track-order.html">Track Order</a> and enter your order number and email.
      </p>`;
  }
  document.querySelector('.confirm-icon')?.classList.add('animated');
}

(async () => {
  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');

  if (!id) {
    document.getElementById('confirm-order-number').textContent = 'Order not found';
    return;
  }

  const stashed = readStashedOrder(id);

  // Ownership-gated lookup: the order UUID alone is no longer enough — the
  // caller must also present the matching email (server-side check).
  const { data: order, error } = await supabase
    .rpc('get_order_public', { p_order_id: id, p_email: stashed.email || '' });

  if (error || !order) {
    renderFallback(stashed.order_number);
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
        <span>${escapeHtml(order.customer_name)}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">mail</span>
        <span>${escapeHtml(order.customer_email)}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">home</span>
        <span>${escapeHtml(order.delivery_address || '—')}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">local_shipping</span>
        <span>${escapeHtml([deliveryMethod, deliveryArea].filter(Boolean).join(' · ') || '—')}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">payments</span>
        <span>${escapeHtml(order.payment_method || '—')}</span>
      </div>
    </div>
    <div class="confirm-items">
      ${(order.items || []).map(item => `
        <div class="confirm-item-row">
          <span>${escapeHtml(item.product_name)} ×${Number(item.quantity)}</span>
          <span>${formatPrice(item.subtotal)}</span>
        </div>
      `).join('')}
    </div>
    <div class="confirm-item-row">
      <span>Subtotal</span>
      <span>${formatPrice(order.subtotal)}</span>
    </div>
    <div class="confirm-item-row">
      <span>Delivery${deliveryMethod ? ` · ${escapeHtml(deliveryMethod)}` : ''}</span>
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

  // One-time stash — clear it so the PII isn't left lying around.
  try { sessionStorage.removeItem('ngl_confirm'); } catch { /* ignore */ }

  // Animate check icon
  document.querySelector('.confirm-icon')?.classList.add('animated');
})();
