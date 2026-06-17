/* ============================================================
   NGL — Customer Order Tracking (v2)
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

/* ── Status config ─────────────────────────────────────────── */
const STATUS_CONFIG = {
  pending: {
    label: 'Order Received',
    desc:  "We've received your order and are reviewing your payment.",
    iconCls: 'status-icon--pending',
    iconSym: 'receipt_long',
    stepIdx: 0,
  },
  processing: {
    label: 'Being Prepared',
    desc:  'Your items are being carefully packed and prepared for shipment.',
    iconCls: 'status-icon--processing',
    iconSym: 'inventory_2',
    stepIdx: 1,
  },
  shipped: {
    label: 'On the Way!',
    desc:  'Your order is with the courier and on its way to you.',
    iconCls: 'status-icon--shipped',
    iconSym: 'local_shipping',
    stepIdx: 2,
  },
  delivered: {
    label: 'Delivered',
    desc:  'Your order has been delivered. Enjoy your NGL Accessories! 💛',
    iconCls: 'status-icon--delivered',
    iconSym: 'check_circle',
    stepIdx: 3,
  },
  cancelled: {
    label: 'Cancelled',
    desc:  'This order has been cancelled.',
    iconCls: 'status-icon--cancelled',
    iconSym: 'cancel',
    stepIdx: -1,
  },
};

const STEP_IDS   = ['step-pending', 'step-processing', 'step-shipped', 'step-delivered'];
// Fill widths (%) for the connector bar: at each step index, what % of the bar is filled
const FILL_WIDTHS = [0, 33, 66, 100];

/* ── DOM refs ──────────────────────────────────────────────── */
const form       = document.getElementById('track-form');
const formCard   = document.getElementById('track-form-card');
const resultEl   = document.getElementById('track-result');
const errorEl    = document.getElementById('track-error');
const errorText  = document.getElementById('track-error-text');
const submitBtn  = document.getElementById('track-submit');

/* ── Error helper ──────────────────────────────────────────── */
function showError(msg) {
  errorText.textContent = msg;
  errorEl.style.display = 'flex';
}
function clearError() {
  errorEl.style.display = 'none';
}

/* ── Render helpers ────────────────────────────────────────── */
function renderStatusCard(order) {
  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;

  // Icon
  const iconEl = document.getElementById('track-status-icon');
  iconEl.className = `track-status-icon ${cfg.iconCls}`;
  document.getElementById('track-status-icon-sym').textContent = cfg.iconSym;

  // Text
  document.getElementById('track-order-num-label').textContent = order.order_number;
  document.getElementById('track-status-label').textContent    = cfg.label;
  document.getElementById('track-status-desc').textContent     = cfg.desc;

  const placed = order.created_at
    ? new Date(order.created_at).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })
    : null;
  document.getElementById('track-placed-date').textContent = placed ? `Ordered ${placed}` : '';
}

function renderProgressSteps(status) {
  const cfg = STATUS_CONFIG[status];
  const cancelledEl = document.getElementById('track-cancelled-card');
  const progressEl  = document.getElementById('track-progress-card');

  if (status === 'cancelled') {
    cancelledEl.style.display = 'flex';
    progressEl.style.display  = 'none';
    return;
  }
  cancelledEl.style.display = 'none';
  progressEl.style.display  = '';

  const stepIdx = cfg?.stepIdx ?? 0;

  STEP_IDS.forEach((id, i) => {
    const el = document.getElementById(id);
    el.classList.remove('done', 'current');
    if (i < stepIdx)  el.classList.add('done');
    if (i === stepIdx) el.classList.add('current');
  });

  // Animate fill bar after short delay
  const fill = document.getElementById('track-step-fill');
  fill.style.width = '0%';
  setTimeout(() => {
    fill.style.width = `${FILL_WIDTHS[stepIdx] || 0}%`;
  }, 80);
}

function renderCourierCard(order) {
  const card = document.getElementById('track-courier-card');
  if (order.status === 'shipped' || order.status === 'delivered') {
    if (order.courier || order.tracking_number) {
      card.style.display = 'flex';
      document.getElementById('track-courier-name').textContent  = order.courier || 'Courier';
      document.getElementById('track-tracking-num').textContent = order.tracking_number || '—';
    } else {
      // Shipped but no tracking yet
      card.style.display = 'flex';
      document.getElementById('track-courier-name').textContent  = 'Tracking details will be updated soon';
      document.getElementById('track-tracking-num').textContent = '—';
    }
  } else {
    card.style.display = 'none';
  }
}

function renderItems(order) {
  const items = order.items || [];
  const itemsEl  = document.getElementById('track-items');
  const totalsEl = document.getElementById('track-totals');

  itemsEl.innerHTML = items.map(item => `
    <div class="track-item-row">
      <span class="track-item-name">
        ${escapeHtml(item.product_name)}
        <span class="track-item-qty">×${item.quantity}</span>
      </span>
      <span class="track-item-price">${formatPrice(item.subtotal || item.price * item.quantity)}</span>
    </div>
  `).join('');

  // Pre-zone orders may not have shipping field
  const shippingVal = order.shipping != null
    ? Number(order.shipping)
    : Math.max(0, Number(order.total) - Number(order.subtotal || 0));

  // Local model: meetup is free, Maxim/Movit fare is paid to the rider.
  const isCourier     = /maxim|movit/i.test(order.delivery_method || '');
  const deliveryValue = shippingVal > 0
    ? formatPrice(shippingVal)
    : (isCourier ? 'Paid to rider' : '🎉 Free');

  totalsEl.innerHTML = `
    ${order.subtotal != null ? `
    <div class="track-total-row">
      <span>Subtotal</span>
      <span>${formatPrice(order.subtotal)}</span>
    </div>
    <div class="track-total-row">
      <span>Delivery${order.delivery_method ? ` · ${escapeHtml(order.delivery_method)}` : ''}</span>
      <span>${deliveryValue}</span>
    </div>` : ''}
    <div class="track-total-row track-total-row--grand">
      <span>Total</span>
      <span>${formatPrice(order.total)}</span>
    </div>
  `;
}

function renderAddress(order) {
  const rows = [];
  if (order.customer_name) {
    rows.push(`<div class="track-addr-row">
      <span class="material-symbols-outlined">person</span>
      <span>${escapeHtml(order.customer_name)}</span>
    </div>`);
  }
  if (order.delivery_address) {
    const addr = [order.delivery_address, order.province].filter(Boolean).join(', ');
    rows.push(`<div class="track-addr-row">
      <span class="material-symbols-outlined">home</span>
      <span>${escapeHtml(addr)}</span>
    </div>`);
  }
  if (order.delivery_method) {
    const dm = [order.delivery_method, order.province].filter(Boolean).join(' · ');
    rows.push(`<div class="track-addr-row">
      <span class="material-symbols-outlined">local_shipping</span>
      <span>${escapeHtml(dm)}</span>
    </div>`);
  }
  if (order.customer_phone) {
    rows.push(`<div class="track-addr-row">
      <span class="material-symbols-outlined">phone_iphone</span>
      <span>${escapeHtml(order.customer_phone)}</span>
    </div>`);
  }
  if (order.payment_method) {
    rows.push(`<div class="track-addr-row">
      <span class="material-symbols-outlined">payments</span>
      <span>${escapeHtml(order.payment_method)}</span>
    </div>`);
  }
  document.getElementById('track-address-rows').innerHTML = rows.join('');
}

/* ── Main render ───────────────────────────────────────────── */
function renderResult(order) {
  renderStatusCard(order);
  renderProgressSteps(order.status);
  renderCourierCard(order);
  renderItems(order);
  renderAddress(order);

  // Swap: hide form, show result
  formCard.style.display  = 'none';
  resultEl.style.display  = '';
  resultEl.style.opacity  = '0';
  resultEl.style.transform = 'translateY(16px)';
  requestAnimationFrame(() => {
    resultEl.style.transition = 'opacity 0.45s, transform 0.45s';
    resultEl.style.opacity    = '1';
    resultEl.style.transform  = 'translateY(0)';
  });
}

/* ── Form submit ───────────────────────────────────────────── */
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const orderNumber = document.getElementById('track-number').value.trim();
  const email       = document.getElementById('track-email').value.trim();
  if (!orderNumber || !email) return;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span> Searching…';

  try {
    const { data, error } = await supabase.rpc('get_order_status', {
      p_order_number: orderNumber,
      p_email:        email,
    });

    // Separate the two failure modes so the real cause isn't hidden:
    // a database/RPC error vs. a problem rendering a found order.
    if (error) {
      console.error('Track order RPC error:', error);
      showError(`Lookup failed: ${error.message || error.code || 'database error'}`);
      return;
    }

    if (!data) {
      showError("We couldn't find an order matching that number and email. Please double-check both fields.");
      return;
    }

    try {
      renderResult(data);
    } catch (renderErr) {
      console.error('Track order render error:', renderErr, data);
      showError(`Couldn't display this order: ${renderErr.message}`);
    }
  } catch (err) {
    console.error('Track order error:', err);
    showError(`Something went wrong: ${err?.message || err}`);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span class="material-symbols-outlined">search</span> Track Order';
  }
});

/* ── "Track another order" button ──────────────────────────── */
document.getElementById('track-again')?.addEventListener('click', () => {
  resultEl.style.display  = 'none';
  formCard.style.display  = '';
  form.reset();
  clearError();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ── Deep link: /track-order.html?order=NGL-...&email=... ──── */
const params       = new URLSearchParams(window.location.search);
const presetOrder  = params.get('order');
const presetEmail  = params.get('email');
if (presetOrder) document.getElementById('track-number').value = presetOrder;
if (presetEmail) document.getElementById('track-email').value  = presetEmail;
if (presetOrder && presetEmail) form?.requestSubmit();
