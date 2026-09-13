/* ============================================================
   NGL Admin — POS Terminal
   ============================================================ */
import { getAllProducts, createOrder, generateOrderNumber, cfImg } from '../src/supabase.js';
import { requireAuth, renderSidebar, showToast, formatPrice, openModal, closeModal } from '../src/admin.js';

let products   = [];
let cart       = [];     // [{ product, quantity }]
let payMethod  = 'cash';
let currentAdmin = null;

(async () => {
  currentAdmin = await requireAuth();
  renderSidebar('POS', currentAdmin);
  products = await getAllProducts();
  renderProductGrid(products);
  setupFilters();
  setupCart();
  setupPayment();
})();

/* ── Product Grid ────────────────────────────────────────── */
function renderProductGrid(prods) {
  const grid = document.getElementById('pos-product-grid');
  const available = prods.filter(p => p.is_active && (p.inventory?.stock || 0) > 0);
  if (available.length === 0) {
    grid.innerHTML = '<p class="table-empty" style="grid-column:1/-1">No products available</p>';
    return;
  }
  grid.innerHTML = available.map(p => {
    const stock = p.inventory?.stock || 0;
    return `
      <button class="pos-product-tile" data-id="${p.id}" title="${p.name}">
        ${p.image_url
          ? `<img src="${cfImg(p.image_url, 400)}" alt="${p.name}" class="pos-tile-img" />`
          : `<div class="pos-tile-placeholder"><span class="material-symbols-outlined">diamond</span></div>`
        }
        <div class="pos-tile-info">
          <span class="pos-tile-name">${p.name}</span>
          <span class="pos-tile-collection pos-coll--${p.collection.toLowerCase()}">${p.collection}</span>
          <div class="pos-tile-bottom">
            <span class="pos-tile-price">${formatPrice(p.price)}</span>
            <span class="pos-tile-stock">${stock} left</span>
          </div>
        </div>
      </button>
    `;
  }).join('');

  document.querySelectorAll('.pos-product-tile').forEach(tile => {
    tile.addEventListener('click', () => addToCart(tile.dataset.id));
  });
}

/* ── Filters ─────────────────────────────────────────────── */
function setupFilters() {
  const search = document.getElementById('pos-search');
  const tabs   = document.querySelectorAll('.pos-tab');

  let activeCollection = '';

  function applyFilter() {
    const q = search.value.toLowerCase();
    const filtered = products.filter(p =>
      p.is_active &&
      (p.inventory?.stock || 0) > 0 &&
      (!activeCollection || p.collection === activeCollection) &&
      (!q || p.name.toLowerCase().includes(q))
    );
    renderProductGrid(filtered);
  }

  search?.addEventListener('input', applyFilter);

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeCollection = tab.dataset.collection;
      applyFilter();
    });
  });
}

/* ── Cart ────────────────────────────────────────────────── */
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  const maxStock = product.inventory?.stock || 0;
  const existing = cart.find(c => c.product.id === productId);

  if (existing) {
    if (existing.quantity >= maxStock) {
      showToast('Cannot exceed available stock', 'warning');
      return;
    }
    existing.quantity++;
  } else {
    if (maxStock === 0) { showToast('Out of stock', 'error'); return; }
    cart.push({ product, quantity: 1 });
  }
  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter(c => c.product.id !== productId);
  renderCart();
}

function updateQty(productId, qty) {
  const item = cart.find(c => c.product.id === productId);
  if (!item) return;
  const maxStock = item.product.inventory?.stock || 0;
  item.quantity = Math.max(1, Math.min(qty, maxStock));
  renderCart();
}

function getDiscount() {
  return Math.max(0, parseFloat(document.getElementById('pos-discount')?.value) || 0);
}

function getSubtotal() {
  return cart.reduce((s, c) => s + (c.product.price * c.quantity), 0);
}

function getTotal() {
  return Math.max(0, getSubtotal() - getDiscount());
}

function renderCart() {
  const container = document.getElementById('pos-cart-items');
  const emptyEl   = document.getElementById('pos-cart-empty');
  const chargeBtn = document.getElementById('pos-charge-btn');

  if (cart.length === 0) {
    emptyEl.style.display = '';
    chargeBtn.disabled    = true;
    document.getElementById('pos-subtotal').textContent = formatPrice(0);
    document.getElementById('pos-total').textContent    = formatPrice(0);
    document.getElementById('pos-discount-row').style.display = 'none';
    // Clear previous items
    container.querySelectorAll('.pos-cart-item').forEach(el => el.remove());
    updateCartSummary();
    document.querySelector('.pos-cart')?.classList.remove('expanded'); // collapse sheet when empty
    return;
  }

  emptyEl.style.display = 'none';
  chargeBtn.disabled    = false;

  // Remove old items
  container.querySelectorAll('.pos-cart-item').forEach(el => el.remove());

  cart.forEach(({ product, quantity }) => {
    const el = document.createElement('div');
    el.className = 'pos-cart-item';
    el.dataset.id = product.id;
    el.innerHTML = `
      <div class="pos-cart-item-info">
        <span class="pos-ci-name">${product.name}</span>
        <span class="pos-ci-price">${formatPrice(product.price)}</span>
      </div>
      <div class="pos-cart-item-controls">
        <button class="pos-qty-btn pos-qty-btn--minus" data-id="${product.id}">−</button>
        <span class="pos-qty-display">${quantity}</span>
        <button class="pos-qty-btn pos-qty-btn--plus" data-id="${product.id}">+</button>
        <span class="pos-ci-subtotal">${formatPrice(product.price * quantity)}</span>
        <button class="pos-remove-btn" data-id="${product.id}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `;
    container.insertBefore(el, emptyEl);
  });

  container.querySelectorAll('.pos-qty-btn--minus').forEach(btn =>
    btn.addEventListener('click', () => {
      const item = cart.find(c => c.product.id === btn.dataset.id);
      if (item && item.quantity > 1) updateQty(btn.dataset.id, item.quantity - 1);
      else removeFromCart(btn.dataset.id);
    })
  );
  container.querySelectorAll('.pos-qty-btn--plus').forEach(btn =>
    btn.addEventListener('click', () => {
      const item = cart.find(c => c.product.id === btn.dataset.id);
      if (item) updateQty(btn.dataset.id, item.quantity + 1);
    })
  );
  container.querySelectorAll('.pos-remove-btn').forEach(btn =>
    btn.addEventListener('click', () => removeFromCart(btn.dataset.id))
  );

  updateTotalsDisplay();
}

function updateTotalsDisplay() {
  const subtotal = getSubtotal();
  const discount = getDiscount();
  const total    = getTotal();

  document.getElementById('pos-subtotal').textContent = formatPrice(subtotal);
  document.getElementById('pos-total').textContent    = formatPrice(total);

  const discRow = document.getElementById('pos-discount-row');
  if (discount > 0) {
    discRow.style.display = '';
    document.getElementById('pos-discount-display').textContent = `-${formatPrice(discount)}`;
  } else {
    discRow.style.display = 'none';
  }
  updateCartSummary();
}

// Collapsed mobile bottom-sheet bar: shows item count + running total at a glance.
function updateCartSummary() {
  const el = document.getElementById('pos-cart-summary');
  if (!el) return;
  const count = cart.reduce((n, c) => n + c.quantity, 0);
  el.textContent = count === 0 ? 'Empty' : `${count} item${count > 1 ? 's' : ''} · ${formatPrice(getTotal())}`;
}

function setupCart() {
  document.getElementById('pos-clear-cart')?.addEventListener('click', () => {
    cart = [];
    renderCart();
  });
  document.getElementById('pos-discount')?.addEventListener('input', () => {
    updateTotalsDisplay();
    updateChangeDisplay();
  });
  // Mobile: tap the cart header to expand/collapse the bottom sheet (ignore the clear button).
  document.getElementById('pos-cart-header')?.addEventListener('click', (e) => {
    if (e.target.closest('#pos-clear-cart')) return;
    document.querySelector('.pos-cart')?.classList.toggle('expanded');
  });
}

/* ── Payment ─────────────────────────────────────────────── */
function setupPayment() {
  // Payment method tabs
  document.querySelectorAll('.pos-pay-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pos-pay-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      payMethod = tab.dataset.method;
      document.getElementById('cash-section').style.display  = payMethod === 'cash' ? '' : 'none';
      document.getElementById('ref-section').style.display   = payMethod !== 'cash' ? '' : 'none';
      if (payMethod !== 'cash') {
        document.getElementById('confirm-payment').disabled = false;
      }
    });
  });

  // Charge button
  document.getElementById('pos-charge-btn')?.addEventListener('click', () => {
    document.getElementById('payment-total-value').textContent = formatPrice(getTotal());
    document.getElementById('cash-tendered').value = '';
    document.getElementById('change-display').style.display = 'none';
    document.getElementById('confirm-payment').disabled = payMethod === 'cash';
    document.getElementById('cash-section').style.display  = payMethod === 'cash' ? '' : 'none';
    document.getElementById('ref-section').style.display   = payMethod !== 'cash' ? '' : 'none';
    openModal('payment-modal');
  });

  document.getElementById('close-payment-modal')?.addEventListener('click', () => closeModal('payment-modal'));
  document.getElementById('cancel-payment')?.addEventListener('click', () => closeModal('payment-modal'));

  // Cash tendered
  document.getElementById('cash-tendered')?.addEventListener('input', updateChangeDisplay);

  // Confirm
  document.getElementById('confirm-payment')?.addEventListener('click', completeSale);

  // Receipt
  document.getElementById('close-receipt-modal')?.addEventListener('click', () => {
    closeModal('receipt-modal');
    cart = [];
    renderCart();
    // Reload products to reflect updated stock
    getAllProducts().then(p => { products = p; });
  });
  document.getElementById('new-transaction')?.addEventListener('click', () => {
    closeModal('receipt-modal');
    cart = [];
    renderCart();
    getAllProducts().then(p => { products = p; renderProductGrid(p); });
  });
  document.getElementById('print-receipt')?.addEventListener('click', () => window.print());
}

function updateChangeDisplay() {
  const tendered = parseFloat(document.getElementById('cash-tendered')?.value) || 0;
  const total    = getTotal();
  const change   = tendered - total;
  const changeEl = document.getElementById('change-display');
  const confirmBtn = document.getElementById('confirm-payment');

  if (tendered >= total && total > 0) {
    changeEl.style.display = '';
    document.getElementById('change-value').textContent = formatPrice(change);
    confirmBtn.disabled = false;
  } else {
    changeEl.style.display = 'none';
    confirmBtn.disabled = true;
  }
}

async function completeSale() {
  const confirmBtn = document.getElementById('confirm-payment');
  confirmBtn.disabled = true;
  confirmBtn.innerHTML = '<span class="material-symbols-outlined">hourglass_empty</span>Processing…';

  try {
    const subtotal = getSubtotal();
    const discount = getDiscount();
    const total    = getTotal();
    const orderNum = generateOrderNumber();
    const refInput = document.getElementById('payment-ref');
    const paymentMethod = payMethod === 'cash' ? 'cash' : (refInput?.value ? `${payMethod} (${refInput.value})` : payMethod);

    const order = await createOrder({
      order_number:   orderNum,
      type:           'pos',
      status:         'completed',
      payment_method: paymentMethod,
      subtotal,
      discount,
      total,
      handled_by:     currentAdmin.id,
    }, cart.map(({ product, quantity }) => ({
      product_id:   product.id,
      product_name: product.name,
      price:        product.price,
      quantity,
    })));

    closeModal('payment-modal');
    showReceipt(order, orderNum, subtotal, discount, total);
    showToast('Sale completed!', 'success');
  } catch (err) {
    showToast('Error processing sale: ' + err.message, 'error');
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<span class="material-symbols-outlined">check_circle</span>Confirm Sale';
  }
}

function showReceipt(order, orderNum, subtotal, discount, total) {
  const tendered = payMethod === 'cash'
    ? parseFloat(document.getElementById('cash-tendered')?.value) || 0
    : null;

  const items = cart.map(({ product, quantity }) => `
    <div class="receipt-item">
      <span>${product.name} ×${quantity}</span>
      <span>${formatPrice(product.price * quantity)}</span>
    </div>
  `).join('');

  document.getElementById('receipt-body').innerHTML = `
    <div class="receipt-header">
      <p class="receipt-brand">NGL Accessories</p>
      <p class="receipt-date">${new Date().toLocaleString('en-PH')}</p>
      <p class="receipt-num">Order: ${orderNum}</p>
    </div>
    <div class="receipt-divider"></div>
    <div class="receipt-items">${items}</div>
    <div class="receipt-divider"></div>
    <div class="receipt-totals">
      <div class="receipt-total-row"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
      ${discount > 0 ? `<div class="receipt-total-row"><span>Discount</span><span>-${formatPrice(discount)}</span></div>` : ''}
      <div class="receipt-total-row receipt-grand"><span>Total</span><span>${formatPrice(total)}</span></div>
      <div class="receipt-total-row"><span>Payment</span><span>${payMethod.toUpperCase()}</span></div>
      ${tendered !== null ? `<div class="receipt-total-row"><span>Tendered</span><span>${formatPrice(tendered)}</span></div>` : ''}
      ${tendered !== null ? `<div class="receipt-total-row receipt-change"><span>Change</span><span>${formatPrice(tendered - total)}</span></div>` : ''}
    </div>
    <div class="receipt-divider"></div>
    <p class="receipt-footer">Thank you for shopping at NGL Accessories ✦</p>
  `;
  openModal('receipt-modal');
}
