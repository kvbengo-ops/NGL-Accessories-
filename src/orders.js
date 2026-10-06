/* ============================================================
   NGL Admin — Orders Management
   ============================================================ */
import { supabase, getOrders, updateOrderStatus, updateOrderFulfilment, cfImg } from '../src/supabase.js';
import { requireAuth, renderSidebar, showToast, formatPrice, formatDate, statusBadge, openModal, closeModal, escapeHtml } from '../src/admin.js';

let allOrders = [];

const ONLINE_STATUSES = ['pending','processing','shipped','delivered','cancelled'];
const POS_STATUSES    = ['completed','voided'];

(async () => {
  const admin = await requireAuth();
  renderSidebar('Orders', admin);
  await loadOrders();
  setupFilters();
  setupModal();
  setupExport();

  // Real-time new orders
  supabase.channel('orders-watch')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async () => {
      showToast('New order received!', 'info');
      await loadOrders();
    })
    .subscribe();
})();

async function loadOrders() {
  const tbody = document.getElementById('orders-body');
  tbody.innerHTML = '<tr><td colspan="4" class="table-loading">Loading…</td></tr>';
  allOrders = await getOrders();
  applyOrderFilters();
}

function renderTable(orders) {
  const tbody = document.getElementById('orders-body');
  document.getElementById('orders-count').textContent = `${orders.length} of ${allOrders.length} orders`;
  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No orders found</td></tr>';
    return;
  }
  tbody.innerHTML = orders.map(o => `
    <tr data-id="${o.id}">
      <td class="orders-customer-cell"><span class="orders-customer">${escapeHtml(o.customer_name || (o.type === 'pos' ? 'Walk-in customer' : 'Customer'))}</span><span class="orders-meta">${escapeHtml(String(o.order_number))} ? ${escapeHtml(formatDate(o.created_at))}</span><span class="orders-meta">${o.type === 'pos' ? 'In store' : 'Online'} ? ${(o.order_items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0)} items</span></td>
      <td class="orders-status-cell">
        <details class="order-status-picker">
          <summary aria-label="Change status for order ${escapeHtml(String(o.order_number))}: ${escapeHtml(o.status)}">${escapeHtml(o.status)} <span aria-hidden="true">⌄</span></summary>
          <div class="order-status-options" aria-label="Choose order status">
          ${(o.type === 'online' ? ONLINE_STATUSES : POS_STATUSES).map(status =>
            `<button type="button" data-status="${status}" data-order-id="${o.id}" ${status === o.status ? 'disabled aria-current="true"' : ''}>${status.charAt(0).toUpperCase() + status.slice(1)}${status === o.status ? '<span aria-hidden="true">✓</span>' : ''}</button>`
          ).join('')}
          </div>
        </details>
      </td>
      <td class="orders-amount">${formatPrice(o.total)}</td>
      <td class="orders-detail-cell"><button class="orders-view" data-view-id="${o.id}" aria-label="View order ${escapeHtml(String(o.order_number))}">Details <span aria-hidden="true">?</span></button></td>
    </tr>
  `).join('');

  // Status change
  document.querySelectorAll('[data-status]').forEach(sel => {
    sel.addEventListener('click', async () => {
      const id = sel.dataset.orderId;
      const order = allOrders.find(o => o.id === id);
      const picker = sel.closest('details');
      if (!confirm('Are you sure you want to change the status of this order?')) {
        picker.open = false;
        picker.querySelector('summary').focus();
        return;
      }
      picker.querySelectorAll('button').forEach(button => { button.disabled = true; });
      picker.setAttribute('aria-busy', 'true');
      try {
        await updateOrderStatus(id, sel.dataset.status);
        if (order) order.status = sel.dataset.status;
        showToast('Order status updated');
        applyOrderFilters();
        const row = [...document.querySelectorAll('.orders-table tr[data-id]')].find(row => row.dataset.id === id);
        (row?.querySelector('summary') || document.getElementById('orders-filter-status')).focus();
      } catch (error) {
        picker.querySelectorAll('button').forEach(button => { button.disabled = button.dataset.status === order?.status; });
        showToast('Status could not be updated: ' + error.message, 'error');
      } finally { picker.removeAttribute('aria-busy'); }
    });
  });

  // View detail
  document.querySelectorAll('[data-view-id]').forEach(btn => {
    btn.addEventListener('click', () => showOrderDetail(btn.dataset.viewId));
  });
}

/* ── Filters ─────────────────────────────────────────────── */
function applyOrderFilters() {
  const query = document.getElementById('orders-search').value.trim().toLowerCase();
  const type = document.getElementById('orders-filter-type').value;
  const status = document.getElementById('orders-filter-status').value;
  const filtered = allOrders.filter(order =>
    (!query || String(order.order_number || '').toLowerCase().includes(query) || (order.customer_name || '').toLowerCase().includes(query)) &&
    (!type || order.type === type) && (!status || order.status === status)
  ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  renderTable(filtered);
}

function setupFilters() {
  document.addEventListener('click', event => {
    document.querySelectorAll('.order-status-picker[open]').forEach(picker => {
      if (!picker.contains(event.target)) picker.open = false;
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.order-status-picker[open]').forEach(picker => {
      picker.open = false;
      picker.querySelector('summary').focus();
    });
  });
  const ids = ['orders-search', 'orders-filter-type', 'orders-filter-status'];
  ids.forEach(id => document.getElementById(id).addEventListener('input', applyOrderFilters));
  document.getElementById('orders-clear').addEventListener('click', () => {
    ids.forEach(id => { document.getElementById(id).value = ''; });
    applyOrderFilters();
  });
}

function setupModal() {
  document.getElementById('close-order-modal')?.addEventListener('click', () => closeModal('order-detail-modal'));
}

function showOrderDetail(id) {
  const o = allOrders.find(x => x.id === id);
  if (!o) return;

  const items = (o.order_items || []).map(item => `
    <div class="order-detail-item">
      <span class="odi-name">${item.product_name}</span>
      <span class="odi-qty">×${item.quantity}</span>
      <span class="odi-price">${formatPrice(item.subtotal)}</span>
    </div>
  `).join('');

  // Local delivery: shipping is ₱0 (meetup free / Maxim·Movit fare paid to rider).
  const shippingVal = o.shipping != null
    ? Number(o.shipping)
    : Math.max(0, Number(o.total) - Math.max(0, Number(o.subtotal) - Number(o.discount || 0)));
  const isCourier   = /maxim|movit/i.test(o.delivery_method || '');
  const deliveryVal = shippingVal > 0 ? formatPrice(shippingVal) : (isCourier ? 'Paid to rider' : 'Free');

  document.getElementById('order-detail-number').textContent = o.order_number;
  document.getElementById('order-detail-content').innerHTML = `
    <div class="order-detail-grid">
      <div class="order-detail-section">
        <h3 class="order-detail-heading">Customer</h3>
        <p>${escapeHtml(o.customer_name) || '—'}</p>
        <p>${escapeHtml(o.customer_email) || '—'}</p>
        <p>${escapeHtml(o.customer_phone) || '—'}</p>
        ${o.delivery_address ? `<p class="addr">${escapeHtml(o.delivery_address)}</p>` : ''}
        ${o.province ? `<p class="addr"><strong>Area:</strong> ${escapeHtml(o.province)}</p>` : ''}
        ${o.delivery_method ? `<p class="addr"><strong>Delivery:</strong> ${escapeHtml(o.delivery_method)}</p>` : ''}
        ${o.order_notes ? `<p class="notes">Notes: ${escapeHtml(o.order_notes)}</p>` : ''}
      </div>
      <div class="order-detail-section">
        <h3 class="order-detail-heading">Payment</h3>
        <p>${o.payment_method || '—'}</p>
        <p>Type: <span class="type-badge type-badge--${o.type}">${o.type}</span></p>
        <p>Status: ${statusBadge(o.status)}</p>
        <p>Date: ${formatDate(o.created_at)}</p>
        ${o.payment_proof_url ? `
          <a href="${cfImg(o.payment_proof_url)}" target="_blank" rel="noopener" class="payment-proof-link" title="Open full receipt">
            <img src="${cfImg(o.payment_proof_url)}" loading="lazy" alt="Payment receipt" class="payment-proof-thumb" />
            <span>View payment receipt <span class="material-symbols-outlined">open_in_new</span></span>
          </a>` : (o.type === 'online' ? '<p class="payment-proof-missing"><span class="material-symbols-outlined">image_not_supported</span> No receipt uploaded</p>' : '')}
        ${o.type === 'online' && o.status === 'pending' ? `
          <div class="payment-verify-actions">
            <button class="btn-verify btn-verify--approve" id="verify-approve" type="button">
              <span class="material-symbols-outlined">check_circle</span> Approve payment
            </button>
            <button class="btn-verify btn-verify--reject" id="verify-reject" type="button">
              <span class="material-symbols-outlined">cancel</span> Reject
            </button>
          </div>` : ''}
      </div>
    </div>
    ${o.type === 'online' ? `
    <div class="order-detail-section">
      <h3 class="order-detail-heading">Fulfilment</h3>
      <div class="form-grid-2">
        <div class="form-field">
          <label class="form-label" for="fulfil-courier">Courier</label>
          <input type="text" id="fulfil-courier" class="form-input" placeholder="e.g. Maxim, Movit, Meetup"
            value="${escapeHtml(o.courier || '')}" />
        </div>
        <div class="form-field">
          <label class="form-label" for="fulfil-tracking">Tracking Number</label>
          <input type="text" id="fulfil-tracking" class="form-input" placeholder="Tracking #"
            value="${escapeHtml(o.tracking_number || '')}" />
        </div>
      </div>
      <button class="btn-admin-primary" id="save-fulfilment" type="button">
        <span class="material-symbols-outlined">local_shipping</span>
        Save Fulfilment
      </button>
    </div>` : ''}
    <div class="order-detail-section">
      <h3 class="order-detail-heading">Items</h3>
      <div class="order-detail-items">${items || '<p>No items</p>'}</div>
      <div class="order-detail-totals">
        <div class="total-row"><span>Subtotal</span><span>${formatPrice(o.subtotal)}</span></div>
        ${o.discount > 0 ? `<div class="total-row total-row--discount"><span>Discount</span><span>-${formatPrice(o.discount)}</span></div>` : ''}
        ${o.type === 'online' ? `<div class="total-row"><span>Delivery${o.delivery_method ? ` · ${escapeHtml(o.delivery_method)}` : ''}</span><span>${deliveryVal}</span></div>` : ''}
        <div class="total-row total-row--grand"><span>Total</span><span>${formatPrice(o.total)}</span></div>
      </div>
    </div>
  `;

  document.getElementById('save-fulfilment')?.addEventListener('click', async () => {
    const btn      = document.getElementById('save-fulfilment');
    const courier  = document.getElementById('fulfil-courier').value.trim();
    const tracking = document.getElementById('fulfil-tracking').value.trim();
    btn.disabled = true;
    try {
      await updateOrderFulfilment(o.id, courier, tracking);
      o.courier = courier;
      o.tracking_number = tracking;
      showToast('Fulfilment details saved');
    } catch (err) {
      showToast('Failed to save: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // One-click payment verification (maps onto the existing status flow):
  // approve → processing, reject → cancelled (stock auto-restores on cancel).
  async function verifyOrder(newStatus, btn) {
    const confirmMsg = newStatus === 'processing'
      ? 'Approve this payment and move the order to Processing?'
      : 'Reject and cancel this order? Any reserved stock will be restored.';
    if (!confirm(confirmMsg)) return;
    btn.disabled = true;
    try {
      await updateOrderStatus(o.id, newStatus);
      showToast(newStatus === 'processing' ? 'Payment approved — order is now Processing' : 'Order rejected & cancelled');
      closeModal('order-detail-modal');
      await loadOrders();
    } catch (err) {
      showToast('Failed: ' + err.message, 'error');
      btn.disabled = false;
    }
  }
  document.getElementById('verify-approve')?.addEventListener('click', (e) => verifyOrder('processing', e.currentTarget));
  document.getElementById('verify-reject')?.addEventListener('click', (e) => verifyOrder('cancelled', e.currentTarget));

  openModal('order-detail-modal');
}

/* ── CSV Export ──────────────────────────────────────────── */
function setupExport() {
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    const headers = ['Order #','Type','Status','Customer','Email','Phone','Area','Delivery','Total','Payment','Courier','Tracking #','Date'];
    const rows = allOrders.map(o => [
      o.order_number, o.type, o.status,
      o.customer_name || '',
      o.customer_email || '',
      o.customer_phone || '',
      o.province || '',
      o.delivery_method || '',
      o.total,
      o.payment_method || '',
      o.courier || '',
      o.tracking_number || '',
      new Date(o.created_at).toLocaleString('en-PH'),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `ngl-orders-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported!');
  });
}
