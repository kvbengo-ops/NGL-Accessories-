/* ============================================================
   NGL — Customer Order Tracking
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

const form     = document.getElementById('track-form');
const result   = document.getElementById('track-result');
const errorEl  = document.getElementById('track-error');
const submitBtn = document.getElementById('track-submit');

// Online order lifecycle, in order. `cancelled` is handled separately.
const STAGES = [
  { key: 'pending',    label: 'Order Received', desc: "We're reviewing your order" },
  { key: 'processing', label: 'Processing',     desc: 'Your items are being prepared' },
  { key: 'shipped',    label: 'Shipped',        desc: 'On the way to you (3–5 business days)' },
  { key: 'delivered',  label: 'Delivered',      desc: 'Enjoy your NGL Accessories!' },
];

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.style.display = '';
}

function renderTimeline(status) {
  const el = document.getElementById('track-timeline');

  if (status === 'cancelled') {
    el.innerHTML = `
      <div class="confirm-tl-item tl-active">
        <div class="tl-dot" style="background:var(--coral,#e07a5f)"></div>
        <div class="tl-content">
          <span class="tl-label">Order Cancelled</span>
          <span class="tl-desc">This order was cancelled. Contact us if you think this is a mistake.</span>
        </div>
      </div>`;
    return;
  }

  const currentIdx = STAGES.findIndex(s => s.key === status);
  el.innerHTML = STAGES.map((s, i) => `
    <div class="confirm-tl-item ${i <= currentIdx ? 'tl-active' : ''}">
      <div class="tl-dot"></div>
      <div class="tl-content">
        <span class="tl-label">${s.label}</span>
        <span class="tl-desc">${s.desc}</span>
      </div>
    </div>
  `).join('');
}

function renderResult(order) {
  document.getElementById('track-order-number').textContent = order.order_number;

  const items = (order.items || []).map(item => `
    <div class="confirm-item-row">
      <span>${escapeHtml(item.product_name)} ×${item.quantity}</span>
      <span>${formatPrice(item.subtotal)}</span>
    </div>
  `).join('');

  const placed = order.created_at
    ? new Date(order.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
    : '—';

  // Pre-zone orders have no `shipping` — derive it so the breakdown balances.
  const shippingVal = order.shipping != null
    ? Number(order.shipping)
    : Math.max(0, Number(order.total) - Number(order.subtotal || 0));

  document.getElementById('track-order-details').innerHTML = `
    <div class="confirm-detail-grid">
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">pending_actions</span>
        <span>Status: <strong>${escapeHtml(order.status)}</strong></span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">calendar_today</span>
        <span>Placed: ${placed}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">home</span>
        <span>${escapeHtml(order.delivery_address) || '—'}${order.province ? `, ${escapeHtml(order.province)}` : ''}</span>
      </div>
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">payments</span>
        <span>${escapeHtml(order.payment_method) || '—'}</span>
      </div>
      ${order.courier || order.tracking_number ? `
      <div class="confirm-detail-row">
        <span class="material-symbols-outlined">local_shipping</span>
        <span>${escapeHtml(order.courier) || 'Courier'}${order.tracking_number ? ` · Tracking #: <strong>${escapeHtml(order.tracking_number)}</strong>` : ''}</span>
      </div>` : ''}
    </div>
    <div class="confirm-items">${items}</div>
    ${order.subtotal != null ? `
    <div class="confirm-item-row">
      <span>Subtotal</span>
      <span>${formatPrice(order.subtotal)}</span>
    </div>
    <div class="confirm-item-row">
      <span>Shipping${order.province ? ` · ${escapeHtml(order.province)}` : ''}</span>
      <span>${shippingVal > 0 ? formatPrice(shippingVal) : 'Free'}</span>
    </div>` : ''}
    <div class="confirm-total-row">
      <span>Total</span>
      <span>${formatPrice(order.total)}</span>
    </div>
  `;

  renderTimeline(order.status);

  form.classList.add('hidden');
  result.classList.remove('hidden');
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.style.display = 'none';

  const orderNumber = document.getElementById('track-number').value.trim();
  const email       = document.getElementById('track-email').value.trim();
  if (!orderNumber || !email) return;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Searching…';

  try {
    const { data, error } = await supabase.rpc('get_order_status', {
      p_order_number: orderNumber,
      p_email: email,
    });
    if (error) throw error;

    if (!data) {
      showError("We couldn't find an order matching that number and email. Please double-check both.");
      return;
    }
    renderResult(data);
  } catch (err) {
    showError('Something went wrong looking up your order. Please try again.');
    console.error('Track order error:', err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="material-symbols-outlined">search</span> Track Order';
  }
});

document.getElementById('track-again')?.addEventListener('click', () => {
  result.classList.add('hidden');
  form.classList.remove('hidden');
  form.reset();
});

// Allow deep-linking: /track-order.html?order=NGL-...&email=...
const params = new URLSearchParams(window.location.search);
const presetOrder = params.get('order');
const presetEmail = params.get('email');
if (presetOrder) document.getElementById('track-number').value = presetOrder;
if (presetEmail) document.getElementById('track-email').value = presetEmail;
if (presetOrder && presetEmail) form?.requestSubmit();
